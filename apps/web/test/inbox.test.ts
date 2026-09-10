import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { createFilesystemDocumentStore } from '@klopt/adapters'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { setDocumentStoreForTest } from '../src/api/document-store.js'
import {
  handleDiscardInboxItem,
  handleDraftFromInbox,
  handleGetDocument,
  handleListInbox,
  handleReceiveDocument,
} from '../src/api/handlers/inbox.js'
import {
  handleBookPurchaseInvoice,
  handleGetPurchaseInvoice,
} from '../src/api/handlers/purchase.js'
import { handleCreateContact, handleGetInvoiceUbl } from '../src/api/handlers/sales.js'
import { handleUpdateEntity } from '../src/api/handlers/setup.js'
import {
  bookPurchaseInvoiceBody,
  createContactBody,
  discardInboxItemBody,
  draftFromInboxBody,
} from '../src/api/schemas.js'

/**
 * The purchase inbox, end to end.
 *
 * The assertion this file exists for is the last one: an invoice this system
 * generated, fed back in as a document, matched to its sender, drafted, coded
 * and booked. If the outbound and inbound halves ever disagree about what a UBL
 * invoice is, that is where it shows — and it is the same exercise a real
 * counterparty puts us through, with a document we can regenerate.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let documentDirectory: string

function request(token: string, idempotencyKey?: string): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/x', { headers })
}

const context = (token: string, key?: string) =>
  resolveRequestContext({ database, request: request(token, key) })

async function newEntity() {
  const entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)
  const { token } = await issueToken(database, {
    entityId,
    name: 'inbox-test',
    permissions: ['*'],
    actorKind: 'human',
    actorId: `human-${entityId.slice(0, 8)}`,
  })
  return { entityId, token }
}

async function aSupplier(token: string, overrides: Record<string, unknown> = {}) {
  await handleCreateContact(
    await context(token, uuidv7()),
    createContactBody.parse({
      number: 'CRE-0001',
      name: 'Leverancier B.V.',
      email: 'facturen@leverancier.test',
      vatNumber: 'NL987654321B01',
      kvkNumber: '87654321',
      iban: 'NL02ABNA0123456789',
      isCustomer: false,
      isSupplier: true,
      ...overrides,
    }),
  )
}

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>F-2026-0042</cbc:ID>
  <cbc:IssueDate>2026-02-10</cbc:IssueDate>
  <cbc:DueDate>2026-03-12</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>Leverancier B.V.</cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme><cbc:CompanyID>NL987654321B01</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">210.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1210.00</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Kantoorartikelen</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
  </cac:InvoiceLine>
</Invoice>`

const bytes = (text: string) => new TextEncoder().encode(text)

const receive = (
  token: string,
  overrides: Partial<Parameters<typeof handleReceiveDocument>[1]> = {},
) =>
  context(token, uuidv7()).then((ctx) =>
    handleReceiveDocument(ctx, {
      bytes: bytes(UBL),
      filename: 'factuur.xml',
      contentType: 'application/xml',
      source: 'upload',
      receivedFrom: null,
      subject: null,
      ...overrides,
    }),
  )

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
  documentDirectory = mkdtempSync(join(tmpdir(), 'klopt-documents-'))
  setDocumentStoreForTest(createFilesystemDocumentStore({ directory: documentDirectory }))
}, 60_000)

afterAll(async () => {
  // Take away the fixtures that would otherwise keep the worker busy.
  await cleanupSeededBackgroundWork(database)
  setDocumentStoreForTest(null)
  setDatabaseForTest(null)
  rmSync(documentDirectory, { recursive: true, force: true })
  await closeDatabase(database)
})

describe('receiving a document', () => {
  it('stores it, reads it, and matches it to its sender', async () => {
    const { token } = await newEntity()
    await aSupplier(token)

    const received = await receive(token)

    expect(received.status).toBe(201)
    expect(received.body.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(received.body.alreadyHeld).toBe(false)
    expect(received.body.parseError).toBeNull()
    // Matched by VAT number, which identifies a company. A name does not.
    expect(received.body.matchedSupplier?.number).toBe('CRE-0001')
    expect(received.body.parsed?.invoice.total).toBe('121000')
    expect(received.body.parsed?.invoice.lines[0]?.taxCode).toBe('VH21')
  })

  it('recognises the same bytes arriving again', async () => {
    // The point of content addressing: an invoice emailed and then sent over
    // Peppol is one document and two arrivals.
    const { token } = await newEntity()
    await aSupplier(token)

    const first = await receive(token)
    const second = await receive(token, { source: 'peppol', receivedFrom: '0106:87654321' })

    expect(second.body.sha256).toBe(first.body.sha256)
    expect(second.body.documentId).toBe(first.body.documentId)
    expect(second.body.alreadyHeld).toBe(true)

    const listed = await handleListInbox(await context(token), {})
    // Two items, one document, and both say they have seen these bytes before.
    expect(listed.body.items).toHaveLength(2)
    expect(listed.body.items.every((item) => item.seenBefore)).toBe(true)
    expect(new Set(listed.body.items.map((item) => item.documentId)).size).toBe(1)
  })

  it('keeps a document it cannot read, with the reason', async () => {
    // A PDF is the commonest arrival and nothing can be read out of it. Losing
    // it because the parser did not like it would be the worst thing an inbox
    // could do.
    const { token } = await newEntity()

    const received = await receive(token, {
      bytes: bytes('%PDF-1.7\nnot really a pdf'),
      filename: 'factuur.pdf',
      contentType: 'application/pdf',
    })

    expect(received.status).toBe(201)
    expect(received.body.parsed).toBeNull()
    // Not even attempted: it is not XML.
    expect(received.body.parseError).toBeNull()

    const listed = await handleListInbox(await context(token), {})
    expect(listed.body.items[0]?.contentType).toBe('application/pdf')
    expect(listed.body.waiting).toBe(1)
  })

  it('keeps XML that is not a UBL invoice, and says why nothing was read', async () => {
    const { token } = await newEntity()
    const received = await receive(token, { bytes: bytes('<hello><world/></hello>') })

    expect(received.status).toBe(201)
    expect(received.body.parsed).toBeNull()
    expect(received.body.parseError).toContain('Invoice or CreditNote')
  })

  it('leaves a document unmatched rather than guessing from a name', async () => {
    // "Jansen B.V." matching the wrong Jansen is worse than no match, because
    // nobody looks at a match that already happened.
    const { token } = await newEntity()
    await aSupplier(token, { vatNumber: null, kvkNumber: null, iban: null })

    const received = await receive(token)
    expect(received.body.matchedSupplier).toBeNull()
  })

  it('refuses an empty file', async () => {
    const { token } = await newEntity()
    await expect(receive(token, { bytes: new Uint8Array() })).rejects.toMatchObject({
      code: 'validation_failed',
    })
  })

  it('gives the bytes back exactly', async () => {
    const { token } = await newEntity()
    const received = await receive(token)

    const document = await handleGetDocument(await context(token), received.body.documentId)
    expect(new TextDecoder().decode(document.bytes)).toBe(UBL)
    expect(document.contentType).toBe('application/xml')
    expect(document.filename).toBe('factuur.xml')
  })
})

describe('turning an arrival into a draft', () => {
  it('drafts it, attaches the original, and leaves it bookable', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const received = await receive(token)

    const drafted = await handleDraftFromInbox(
      await context(token, uuidv7()),
      received.body.id,
      draftFromInboxBody.parse({
        // The parse parked every line on the tussenrekening; a human codes it.
        lines: [{ accountNumber: '4000', taxCode: 'VH21' }],
      }),
    )

    expect(drafted.status).toBe(201)
    expect(drafted.body.supplierInvoiceNumber).toBe('F-2026-0042')
    expect(drafted.body.total).toBe('121000')
    expect(drafted.body.bookable).toBe(true)
    expect(drafted.body.findings).toEqual([])

    const invoice = await handleGetPurchaseInvoice(await context(token), drafted.body.id)
    expect(invoice.body.status).toBe('draft')
    expect(invoice.body.lines[0]?.accountNumber).toBe('4000')

    // The item is off the queue and points at what it became.
    const listed = await handleListInbox(await context(token), {})
    expect(listed.body.waiting).toBe(0)
    expect(listed.body.items[0]?.state).toBe('drafted')
    expect(listed.body.items[0]?.purchaseInvoiceId).toBe(drafted.body.id)
  })

  it('books what it drafted, and the VAT lands in 5b', async () => {
    // The whole loop: a document arrives, becomes a draft, becomes an entry,
    // becomes a deduction.
    const { token } = await newEntity()
    await aSupplier(token)
    const received = await receive(token)

    const drafted = await handleDraftFromInbox(
      await context(token, uuidv7()),
      received.body.id,
      draftFromInboxBody.parse({ lines: [{ accountNumber: '4000', taxCode: 'VH21' }] }),
    )
    const booked = await handleBookPurchaseInvoice(
      await context(token, uuidv7()),
      drafted.body.id,
      bookPurchaseInvoiceBody.parse({}),
    )

    expect(booked.body.status).toBe('booked')

    const { handleGetVatReturn } = await import('../src/api/handlers/vat.js')
    const aangifte = await handleGetVatReturn(await context(token), '2026-Q1')
    expect(aangifte.body.deductible).toBe('21000')
  })

  it('refuses to draft twice from the same arrival', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const received = await receive(token)
    const body = draftFromInboxBody.parse({ lines: [{ accountNumber: '4000', taxCode: 'VH21' }] })

    await handleDraftFromInbox(await context(token, uuidv7()), received.body.id, body)
    await expect(
      handleDraftFromInbox(await context(token, uuidv7()), received.body.id, body),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('refuses when the same invoice number is already booked', async () => {
    // The same document arriving twice by different routes. The first became an
    // invoice; the second must not.
    const { token } = await newEntity()
    await aSupplier(token)
    const body = draftFromInboxBody.parse({ lines: [{ accountNumber: '4000', taxCode: 'VH21' }] })

    const first = await receive(token)
    await handleDraftFromInbox(await context(token, uuidv7()), first.body.id, body)

    const second = await receive(token, { source: 'email', receivedFrom: 'boekhouding@x.test' })
    await expect(
      handleDraftFromInbox(await context(token, uuidv7()), second.body.id, body),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('refuses a line with no account or no tax code chosen', async () => {
    // The parse parks lines on the tussenrekening and suggests a code, and both
    // are suggestions. Drafting without confirming them is refused rather than
    // silently accepting a guess.
    const { token } = await newEntity()
    await aSupplier(token)
    const received = await receive(token, {
      bytes: bytes(UBL.replace('<cbc:Percent>21</cbc:Percent>', '<cbc:Percent>13.5</cbc:Percent>')),
    })

    await expect(
      handleDraftFromInbox(
        await context(token, uuidv7()),
        received.body.id,
        draftFromInboxBody.parse({ lines: [{ accountNumber: '4000' }] }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('will not draft from something nothing could be read out of', async () => {
    const { token } = await newEntity()
    const received = await receive(token, {
      bytes: bytes('%PDF-1.7'),
      filename: 'factuur.pdf',
      contentType: 'application/pdf',
    })

    await expect(
      handleDraftFromInbox(
        await context(token, uuidv7()),
        received.body.id,
        draftFromInboxBody.parse({}),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('needs a supplier when the document did not identify one', async () => {
    const { token } = await newEntity()
    await aSupplier(token, { vatNumber: null, kvkNumber: null, iban: null })
    const received = await receive(token)

    await expect(
      handleDraftFromInbox(
        await context(token, uuidv7()),
        received.body.id,
        draftFromInboxBody.parse({ lines: [{ accountNumber: '4000', taxCode: 'VH21' }] }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })

    // Naming it works.
    const drafted = await handleDraftFromInbox(
      await context(token, uuidv7()),
      received.body.id,
      draftFromInboxBody.parse({
        contactNumber: 'CRE-0001',
        lines: [{ accountNumber: '4000', taxCode: 'VH21' }],
      }),
    )
    expect(drafted.status).toBe(201)
  })
})

describe('discarding', () => {
  it('needs a reason and keeps the document', async () => {
    const { token } = await newEntity()
    const received = await receive(token, {
      bytes: bytes('%PDF-1.7 reclame'),
      filename: 'folder.pdf',
      contentType: 'application/pdf',
    })

    const discarded = await handleDiscardInboxItem(
      await context(token, uuidv7()),
      received.body.id,
      discardInboxItemBody.parse({ reason: 'Reclamefolder, geen factuur.' }),
    )
    expect(discarded.body.state).toBe('discarded')

    const listed = await handleListInbox(await context(token), {})
    expect(listed.body.waiting).toBe(0)
    expect(listed.body.items[0]?.discardedReason).toContain('Reclamefolder')

    // The bytes are still there. Discarding says "this is not an invoice for
    // us", not "these bytes never existed".
    const document = await handleGetDocument(await context(token), received.body.documentId)
    expect(document.bytes.byteLength).toBeGreaterThan(0)
  })

  it('refuses to discard something that became a draft', async () => {
    const { token } = await newEntity()
    await aSupplier(token)
    const received = await receive(token)
    await handleDraftFromInbox(
      await context(token, uuidv7()),
      received.body.id,
      draftFromInboxBody.parse({ lines: [{ accountNumber: '4000', taxCode: 'VH21' }] }),
    )

    await expect(
      handleDiscardInboxItem(
        await context(token, uuidv7()),
        received.body.id,
        discardInboxItemBody.parse({ reason: 'Toch niet.' }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('the round trip', () => {
  it('reads back an invoice this system sent, and books it', async () => {
    // The claim M4 exists to make: what we generate, we can consume. A real
    // counterparty puts us through exactly this, with a document we cannot
    // regenerate when it fails — so we do it here with one we can.
    const seller = await newEntity()

    // The seller details a Dutch BIS invoice cannot go without — the same ones
    // `handleGetInvoiceUbl` refuses an invoice for when they are missing.
    await handleUpdateEntity(await context(seller.token, uuidv7()), {
      legalName: 'Test Beheer B.V.',
      street: 'Keizersgracht',
      houseNumber: '123-B',
      postalCode: '1015 CJ',
      city: 'Amsterdam',
      countryCode: 'NL',
      kvkNumber: '12345678',
      vatNumber: 'NL123456789B01',
      iban: 'NL02ABNA0123456789',
      bic: 'ABNANL2A',
      email: 'facturen@test.nl',
    })

    await handleCreateContact(
      await context(seller.token, uuidv7()),
      createContactBody.parse({
        number: 'DEB-0001',
        name: 'Koper B.V.',
        email: 'inkoop@koper.test',
        vatNumber: 'NL123456789B01',
        kvkNumber: '12345678',
        address: {
          street: 'Coolsingel',
          houseNumber: '42',
          postalCode: '3011 AD',
          city: 'Rotterdam',
          countryCode: 'NL',
        },
      }),
    )

    const { handleDraftInvoice, handleIssueInvoice } = await import('../src/api/handlers/sales.js')
    const { draftInvoiceBody, issueInvoiceBody } = await import('../src/api/schemas.js')

    const drafted = await handleDraftInvoice(
      await context(seller.token, uuidv7()),
      draftInvoiceBody.parse({
        contactNumber: 'DEB-0001',
        issueDate: '2026-02-10',
        // PEPPOL-EN16931-R003: a buyer reference or purchase order reference is
        // mandatory, and this is the outbound path's own rule refusing to send
        // without one.
        buyerReference: 'KOSTENPLAATS-42',
        lines: [
          {
            description: 'Advieswerk',
            quantity: '1',
            unitPrice: '100000',
            revenueAccountNumber: '8000',
            taxCode: 'H21',
          },
        ],
      }),
    )
    await handleIssueInvoice(
      await context(seller.token, uuidv7()),
      drafted.body.id,
      issueInvoiceBody.parse({}),
    )

    const ubl = await handleGetInvoiceUbl(await context(seller.token), drafted.body.id)

    // Now the other side of the same transaction: a different administration
    // receives that document.
    const buyer = await newEntity()
    await handleCreateContact(
      await context(buyer.token, uuidv7()),
      createContactBody.parse({
        number: 'CRE-9001',
        name: 'De verkoper',
        // The seed entity's own VAT number, which is what the UBL carries.
        vatNumber: 'NL123456789B01',
        isCustomer: false,
        isSupplier: true,
      }),
    )

    const received = await handleReceiveDocument(await context(buyer.token, uuidv7()), {
      bytes: bytes(ubl.xml),
      filename: 'inkomende-factuur.xml',
      contentType: 'application/xml',
      source: 'peppol',
      receivedFrom: '0106:12345678',
      subject: null,
    })

    expect(received.body.parseError).toBeNull()
    expect(received.body.matchedSupplier?.number).toBe('CRE-9001')
    // The amounts survive the round trip to the cent.
    expect(received.body.parsed?.invoice.net).toBe('100000')
    expect(received.body.parsed?.invoice.tax).toBe('21000')
    expect(received.body.parsed?.invoice.total).toBe('121000')

    const draftedIn = await handleDraftFromInbox(
      await context(buyer.token, uuidv7()),
      received.body.id,
      draftFromInboxBody.parse({ lines: [{ accountNumber: '4000', taxCode: 'VH21' }] }),
    )
    expect(draftedIn.body.bookable).toBe(true)

    const booked = await handleBookPurchaseInvoice(
      await context(buyer.token, uuidv7()),
      draftedIn.body.id,
      bookPurchaseInvoiceBody.parse({}),
    )
    expect(booked.body.status).toBe('booked')
    expect(booked.body.total).toBe('121000')
  })
})
