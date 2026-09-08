import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import {
  closeDatabase,
  createDatabase,
  issueToken,
  runMigrations,
  withInbox,
  type Database,
} from '@klopt/db'
import { seedEntity, seedSalesConfiguration } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { documentStore } from '../src/api/document-store.js'
import {
  handleDeleteDocuments,
  handleGetRetention,
  handleSetLegalHold,
  handleSetRetentionClass,
} from '../src/api/handlers/retention.js'
import { handleListAuditLog } from '../src/api/handlers/audit.js'
import { handleBookPurchaseInvoice } from '../src/api/handlers/purchase.js'
import { handleCreateContact } from '../src/api/handlers/sales.js'
import {
  handleDraftFromInbox,
  handleGetDocument,
  handleReceiveDocument,
} from '../src/api/handlers/inbox.js'
import { handlePostJournalEntry } from '../src/api/handlers/ledger.js'
import {
  auditLogQuery,
  bookPurchaseInvoiceBody,
  createContactBody,
  deleteDocumentsBody,
  draftFromInboxBody,
  postJournalEntryBody,
  retentionQuery,
  setLegalHoldBody,
  setRetentionClassBody,
} from '../src/api/schemas.js'

/**
 * The bewaarplicht, against a real database and a real document store.
 *
 * The assertions worth having are the refusals. Anybody can write code that
 * deletes things; the whole value here is that it will not delete a document
 * under hold, one whose term is still running, or one whose book year nobody
 * knows — and that the bytes another administration still keeps survive our
 * copy of them expiring.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let documentDirectory: string

/** Unique per run, so content-addressed bytes cannot collide with last week's. */
const RUN = uuidv7()

function request(token: string, idempotencyKey?: string): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/x', { headers })
}

const context = (token: string, key?: string) =>
  resolveRequestContext({ database, request: request(token, key) })

async function newEntity(permissions: string[] = ['*']) {
  // 2018 as well as 2026: seven years after 2018 is 2025, so a document booked
  // in that year is genuinely past its term today. Nothing here can pretend
  // otherwise — `handleDeleteDocuments` asks the clock, not the caller, because
  // deleting by claiming it is 2040 is exactly what must not be possible.
  const entityId = await seedEntity(database, { alsoFiscalYears: ['2018'] })
  await seedSalesConfiguration(database, entityId)
  const { token } = await issueToken(database, {
    entityId,
    name: 'retention-test',
    permissions,
    actorKind: 'human',
    actorId: `human-${entityId.slice(0, 8)}`,
  })
  return { entityId, token }
}

/** A UBL invoice, so the document has something to be evidence for. */
const UBL = (number: string, issued: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${number}</cbc:ID>
  <cbc:IssueDate>${issued}</cbc:IssueDate>
  <cbc:DueDate>${issued}</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
      <cac:PartyName><cbc:Name>Leverancier B.V.</cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme><cbc:CompanyID>NL987654321B01</cbc:CompanyID></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">210.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1210.00</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID>
    <cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Kantoorartikelen</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
  </cac:InvoiceLine>
</Invoice>`

async function aSupplier(token: string) {
  await handleCreateContact(
    await context(token, uuidv7()),
    createContactBody.parse({
      number: 'CRE-0001',
      name: 'Leverancier B.V.',
      vatNumber: 'NL987654321B01',
      isCustomer: false,
      isSupplier: true,
    }),
  )
}

/**
 * A document that is evidence for a booked purchase invoice — the only way a
 * document reaches a book year, and therefore a retention date.
 */
async function aBookedDocument(token: string, number = 'F-2026-0042', issued = '2026-02-10') {
  const received = await handleReceiveDocument(await context(token, uuidv7()), {
    bytes: new TextEncoder().encode(UBL(number, issued)),
    filename: `${number}.xml`,
    contentType: 'application/xml',
    source: 'upload',
    receivedFrom: null,
    subject: null,
  })

  const drafted = await handleDraftFromInbox(
    await context(token, uuidv7()),
    received.body.id,
    // The parse parks every line on the tussenrekening; a human codes it.
    draftFromInboxBody.parse({ lines: [{ accountNumber: '4000', taxCode: 'VH21' }] }),
  )

  await handleBookPurchaseInvoice(
    await context(token, uuidv7()),
    drafted.body.id,
    bookPurchaseInvoiceBody.parse({}),
  )

  return { documentId: received.body.documentId, sha256: received.body.sha256 }
}

/**
 * A document whose bewaarplicht has actually run out.
 *
 * Through a journal entry rather than a purchase invoice, because the fixture's
 * tax codes only start in 2020 and seven years after 2020 has not happened yet.
 * It also exercises the `journal_entry` branch of `dateDocuments`, which
 * nothing else reaches: a receipt attached to a manual entry is exactly the
 * case that branch is for.
 */
async function anExpiredDocument(token: string, entityId: string, marker: string) {
  // The marker carries a per-run suffix, because documents are content-
  // addressed *across* administrations and the test database survives between
  // runs: identical bytes from last week would count as "another
  // administration still keeps this", which is right and would make the
  // deletion test wrong.
  const received = await handleReceiveDocument(await context(token, uuidv7()), {
    bytes: new TextEncoder().encode(`%PDF-1.7 bonnetje ${marker} ${RUN}`),
    filename: `bonnetje-${marker}.pdf`,
    contentType: 'application/pdf',
    source: 'upload',
    receivedFrom: null,
    subject: null,
  })

  const posted = await handlePostJournalEntry(
    await context(token, uuidv7()),
    postJournalEntryBody.parse({
      journalCode: 'MEM',
      bookingDate: '2018-03-15',
      documentDate: '2018-03-15',
      description: `Bonnetje ${marker}`,
      lines: [
        { accountNumber: '4000', debit: '10000' },
        { accountNumber: '1000', credit: '10000' },
      ],
    }),
  )

  await withInbox(database, ({ inbox }) =>
    inbox.link({
      entityId,
      documentId: received.body.documentId,
      subjectKind: 'journal_entry',
      subjectId: (posted.body as { entry: { id: string } }).entry.id,
      role: 'original',
    }),
  )

  return { documentId: received.body.documentId, sha256: received.body.sha256 }
}

const retention = async (token: string, asOf?: string) =>
  (
    await handleGetRetention(
      await context(token),
      retentionQuery.parse(asOf === undefined ? {} : { asOf }),
    )
  ).body

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)

  // Its own directory, so a deletion test cannot take another test's bytes.
  documentDirectory = await mkdtemp(join(tmpdir(), 'klopt-retention-'))
  process.env['KLOPT_DOCUMENT_DIR'] = documentDirectory
}, 60_000)

afterAll(async () => {
  setDatabaseForTest(null)
  await closeDatabase(database)
  await rm(documentDirectory, { recursive: true, force: true })
})

describe('how long each document is kept', () => {
  it('dates a document from the book year of what it is evidence for', async () => {
    // Not from the document's own date: an invoice dated 31 December booked in
    // the next year's opening belongs to the year it was booked in.
    const { token } = await newEntity()
    await aSupplier(token)
    const { documentId } = await aBookedDocument(token)

    const result = await retention(token)
    const document = result.documents.find((row) => row.id === documentId)

    expect(document?.retentionFiscalYear).toBe('2026')
    expect(document?.retainUntil).toBe('2033-12-31')
    expect(document?.state).toBe('retained')
    expect(document?.deletable).toBe(false)
  })

  it('refuses to delete a document whose book year nobody knows', async () => {
    // An upload sitting in the postvak is evidence for nothing yet. Not knowing
    // how long to keep it is not a licence to throw it away.
    const { token } = await newEntity()
    const received = await handleReceiveDocument(await context(token, uuidv7()), {
      bytes: new TextEncoder().encode('%PDF-1.7 een bonnetje'),
      filename: 'bonnetje.pdf',
      contentType: 'application/pdf',
      source: 'upload',
      receivedFrom: null,
      subject: null,
    })

    const result = await retention(token, '2099-01-01')
    const document = result.documents.find((row) => row.id === received.body.documentId)

    expect(document?.retainUntil).toBeNull()
    expect(document?.state).toBe('undated')
    expect(document?.deletable).toBe(false)

    await expect(
      handleDeleteDocuments(
        await context(token, uuidv7()),
        deleteDocumentsBody.parse({
          documentIds: [received.body.documentId],
          reason: 'Opruimen.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('gives onroerend goed ten years, and re-dates it on the spot', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const { documentId } = await aBookedDocument(token)

    await handleSetRetentionClass(
      await context(token, uuidv7()),
      setRetentionClassBody.parse({
        documentIds: [documentId],
        retentionClass: 'immovable_property',
      }),
    )

    const result = await retention(token)
    const document = result.documents.find((row) => row.id === documentId)

    // Seven years would have been 2033. The term follows the class rather than
    // waiting for a job.
    expect(document?.retainUntil).toBe('2036-12-31')
    expect(document?.retentionClass).toBe('immovable_property')
  })

  it('says what the storage itself guarantees, rather than implying it', async () => {
    // Spec 7.6 asks for object lock. A directory has none, and claiming
    // otherwise on a compliance screen would be the worst kind of wrong.
    const { token } = await newEntity()
    const result = await retention(token)

    expect(result.storage.name).toBe('filesystem')
    expect(result.storage.objectLock).toBe(false)
    expect(result.storage.note).toContain('object lock')
  })
})

describe('a legal hold', () => {
  it('beats an expired term, which is the whole point of it', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const { documentId } = await aBookedDocument(token)

    // Long past 2033.
    expect((await retention(token, '2040-01-01')).summary.byState.expired).toBe(1)

    await handleSetLegalHold(
      await context(token, uuidv7()),
      setLegalHoldBody.parse({
        scope: 'documents',
        held: true,
        documentIds: [documentId],
        reason: 'Geschil met de leverancier.',
      }),
    )

    const held = await retention(token, '2040-01-01')
    expect(held.summary.byState.expired).toBe(0)
    expect(held.summary.byState.held).toBe(1)
    expect(held.documents[0]?.legalHoldReason).toBe('Geschil met de leverancier.')

    await expect(
      handleDeleteDocuments(
        await context(token, uuidv7()),
        deleteDocumentsBody.parse({ documentIds: [documentId], reason: 'Opruimen.' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('over the whole administration needs no per-document flag', async () => {
    // A firm under investigation should not have to set a flag on forty
    // thousand rows.
    const { token } = await newEntity()
    await aSupplier(token)
    await aBookedDocument(token)

    await handleSetLegalHold(
      await context(token, uuidv7()),
      setLegalHoldBody.parse({ scope: 'entity', held: true, reason: 'Boekenonderzoek.' }),
    )

    const result = await retention(token, '2040-01-01')
    expect(result.legalHold.held).toBe(true)
    expect(result.summary.byState.held).toBe(1)
    expect(result.summary.deletableBytes).toBe('0')
  })

  it('needs a reason to be set, and none to be lifted', async () => {
    const { token } = await newEntity()

    await expect(
      handleSetLegalHold(
        await context(token, uuidv7()),
        setLegalHoldBody.parse({ scope: 'entity', held: true }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })

    // Lifting is allowed without one: the reason it was there is already in the
    // audit log, and demanding a second one just to undo is friction.
    const lifted = await handleSetLegalHold(
      await context(token, uuidv7()),
      setLegalHoldBody.parse({ scope: 'entity', held: false }),
    )
    expect(lifted.body.held).toBe(false)
  })
})

describe('deleting what the law no longer requires', () => {
  it('deletes the bytes, keeps the row, and records both', async () => {
    // The row stays with its hash: an inspector asking what used to be here
    // gets an answer, and erasing the row would make the deletion unauditable.
    const { entityId, token } = await newEntity()
    const { documentId, sha256 } = await anExpiredDocument(token, entityId, 'delete-1')

    expect(await documentStore().has(sha256)).toBe(true)

    const result = await handleDeleteDocuments(
      await context(token, uuidv7()),
      deleteDocumentsBody.parse({
        documentIds: [documentId],
        reason: 'Bewaartermijn 2026 verlopen.',
      }),
    )

    expect(result.body.deleted).toBe(1)
    expect(result.body.bytesRemoved).toBe(1)
    expect(await documentStore().has(sha256)).toBe(false)

    const after = await retention(token, '2040-01-01')
    const document = after.documents.find((row) => row.id === documentId)
    expect(document?.state).toBe('deleted')
    expect(document?.sha256).toBe(sha256)
    expect(document?.deletedReason).toBe('Bewaartermijn 2026 verlopen.')

    // And asking for it says why it is gone rather than 404. The row survives a
    // deletion precisely so this question has an answer.
    await expect(handleGetDocument(await context(token), documentId)).rejects.toMatchObject({
      code: 'gone',
    })
    // And the refusal says which bytes and why, which is what makes 410 worth
    // having over 404.
    const refusal = await handleGetDocument(await context(token), documentId).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    expect(refusal).toContain(sha256)
    expect(refusal).toContain('Bewaartermijn 2026 verlopen.')
  })

  it('is in the audit log with the reason and the hashes', async () => {
    const { entityId, token } = await newEntity()
    const { documentId, sha256 } = await anExpiredDocument(token, entityId, 'audit-1')

    await handleDeleteDocuments(
      await context(token, uuidv7()),
      deleteDocumentsBody.parse({ documentIds: [documentId], reason: 'Termijn verlopen.' }),
    )

    const log = await handleListAuditLog(
      await context(token),
      auditLogQuery.parse({ action: 'retention.deleteDocuments' }),
    )

    expect(log.body.entries).toHaveLength(1)
    expect(log.body.entries[0]?.after).toMatchObject({
      reason: 'Termijn verlopen.',
      documents: 1,
      hashes: [sha256],
    })
  })

  it('refuses a document whose term is still running, by name', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const { documentId } = await aBookedDocument(token)

    // 2026 runs to the end of 2033, and the handler asks today's date.
    await expect(
      handleDeleteDocuments(
        await context(token, uuidv7()),
        deleteDocumentsBody.parse({ documentIds: [documentId], reason: 'Te vroeg.' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('leaves bytes another administration still keeps', async () => {
    // Documents are content-addressed and shared. One firm's expired copy must
    // not take another firm's records with it.
    const first = await newEntity()
    const second = await newEntity()

    const mine = await anExpiredDocument(first.token, first.entityId, 'shared')
    const theirs = await anExpiredDocument(second.token, second.entityId, 'shared')

    // The same bytes, so the same address.
    expect(theirs.sha256).toBe(mine.sha256)

    const result = await handleDeleteDocuments(
      await context(first.token, uuidv7()),
      deleteDocumentsBody.parse({ documentIds: [mine.documentId], reason: 'Termijn verlopen.' }),
    )

    expect(result.body.deleted).toBe(1)
    expect(result.body.bytesRemoved).toBe(0)
    expect(result.body.keptForOthers).toBe(1)
    // Still readable by the administration that is still keeping it.
    expect(await documentStore().has(mine.sha256)).toBe(true)
  })

  it('refuses a document from another administration', async () => {
    const { token } = await newEntity()
    const other = await newEntity()
    await aSupplier(other.token)
    const theirs = await aBookedDocument(other.token, 'F-OTHER-1')

    await expect(
      handleDeleteDocuments(
        await context(token, uuidv7()),
        deleteDocumentsBody.parse({ documentIds: [theirs.documentId], reason: 'Opruimen.' }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('needs a reason', () => {
    // Refused at the schema, so a caller cannot reach the handler without one.
    // "Who deleted forty thousand documents and why" gets asked.
    expect(() => deleteDocumentsBody.parse({ documentIds: [uuidv7()], reason: '  ' })).toThrow()
  })

  it('needs retention:manage, which ledger:configure does not grant', async () => {
    // Deleting statutory records is the one act here that destroys evidence
    // rather than reversing an entry.
    const { entityId } = await newEntity()
    const { token: bookkeeper } = await issueToken(database, {
      entityId,
      name: 'bookkeeper',
      permissions: ['ledger:read', 'ledger:post', 'ledger:configure', 'ledger:export'],
      actorKind: 'human',
      actorId: 'bookkeeper',
    })

    // The preview is allowed on `ledger:export`…
    await expect(retention(bookkeeper)).resolves.toBeDefined()

    // …and changing anything is not.
    await expect(
      handleSetLegalHold(
        await context(bookkeeper, uuidv7()),
        setLegalHoldBody.parse({ scope: 'entity', held: true, reason: 'Nee.' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })

    await expect(
      handleDeleteDocuments(
        await context(bookkeeper, uuidv7()),
        deleteDocumentsBody.parse({ documentIds: [uuidv7()], reason: 'Nee.' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('is safe to run again after a half-finished one', async () => {
    // The second run finds them already deleted and refuses, rather than
    // deleting something else.
    const { entityId, token } = await newEntity()
    const { documentId } = await anExpiredDocument(token, entityId, 'twice')

    await handleDeleteDocuments(
      await context(token, uuidv7()),
      deleteDocumentsBody.parse({ documentIds: [documentId], reason: 'Termijn verlopen.' }),
    )

    await expect(
      handleDeleteDocuments(
        await context(token, uuidv7()),
        deleteDocumentsBody.parse({ documentIds: [documentId], reason: 'Nog eens.' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })
})
