import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { createFilesystemDocumentStore } from '@klopt/adapters'
import {
  closeDatabase,
  createDatabase,
  issueToken,
  runMigrations,
  withExactConnection,
  type Database,
} from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { setDocumentStoreForTest } from '../src/api/document-store.js'
import { handleGetJournalEntry, handlePostJournalEntry } from '../src/api/handlers/ledger.js'
import {
  handleCreateContact,
  handleDraftInvoice,
  handleGetContact,
  handleGetInvoice,
  handleGetInvoicePdf,
  handleGetInvoiceUbl,
  handleIssueInvoice,
  handleListContacts,
  handleListDeliveries,
  handleListInvoices,
  handleUpdateContact,
} from '../src/api/handlers/sales.js'
import {
  handleBookPurchaseInvoice,
  handleCapturePurchaseInvoice,
  handleGetPurchaseInvoice,
  handleListPurchaseInvoices,
  handleTransitionPurchaseInvoice,
} from '../src/api/handlers/purchase.js'
import {
  handleCreateBankAccount,
  handleImportStatement,
  handleListBankAccounts,
  handleListBankTransactions,
  handleSuggestMatches,
} from '../src/api/handlers/bank.js'
import {
  handleCreateBatch,
  handleGetBatch,
  handleGetBatchPain001,
  handleListBatches,
  handlePreviewPaymentRun,
} from '../src/api/handlers/payments.js'
import {
  handleDiscardInboxItem,
  handleGetDocument,
  handleListInbox,
  handleReceiveDocument,
} from '../src/api/handlers/inbox.js'
import {
  handleAddInboundSource,
  handleListInboundSources,
  handlePollInboundSource,
} from '../src/api/handlers/inbound-sources.js'
import {
  handleGetSnapshotManifest,
  handleListSnapshots,
  handleSealSnapshot,
  handleVerifySnapshot,
} from '../src/api/handlers/snapshots.js'
import { handleGetRetention } from '../src/api/handlers/retention.js'
import { handleListAuditLog } from '../src/api/handlers/audit.js'
import { handleGetEntity, handleUpdateEntity } from '../src/api/handlers/setup.js'
import { handleGetExactConnection } from '../src/api/handlers/exact.js'
import {
  addInboundSourceBody,
  auditLogQuery,
  bookPurchaseInvoiceBody,
  capturePurchaseInvoiceBody,
  createBankAccountBody,
  createBatchBody,
  contactsQuery,
  createContactBody,
  discardInboxItemBody,
  draftInvoiceBody,
  importStatementBody,
  invoicesQuery,
  issueInvoiceBody,
  listPurchaseInvoicesQuery,
  postJournalEntryBody,
  retentionQuery,
  sealSnapshotBody,
  transactionsQuery,
  transitionPurchaseInvoiceBody,
  updateContactBody,
  updateEntityBody,
  verifySnapshotQuery,
} from '../src/api/schemas.js'

/**
 * One administration can see nothing of another (spec 14).
 *
 * > "Single-tenant by default. Multi-entity within one instance from v1,
 * > because holdings and BV structures are the norm."
 *
 * Isolation here rests on every query filtering by `entity_id` — there is no
 * row-level security yet, which the spec puts in phase two for multi-*tenant*
 * hosting. That makes a missing filter the worst bug this codebase could have,
 * and "we were careful" is not a test.
 *
 * So this builds two full administrations and, for every read surface, asks A
 * for B's data. Two shapes of question, because they fail differently:
 *
 *   - **A list** must not contain B's rows. A missing filter here leaks
 *     everything at once and is usually obvious in a screenshot.
 *   - **A lookup by id** must answer `not_found` for B's id. A missing filter
 *     here leaks one row at a time to anybody who can guess or has ever seen an
 *     id — and it is invisible, because the screen looks right.
 *
 * The second is why this file exists. Every handler taking an id is listed
 * below, and a new one that forgets its scope makes this fail.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let documentDirectory: string

/** Unique per run: documents are content-addressed across administrations. */
const RUN = uuidv7()

function request(token: string, idempotencyKey?: string): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/x', { headers })
}

const context = (token: string, key?: string) =>
  resolveRequestContext({ database, request: request(token, key) })

/** Everything one administration can hold, so there is something of each to leak. */
interface Administration {
  readonly entityId: string
  readonly token: string
  readonly contactId: string
  readonly invoiceId: string
  readonly purchaseInvoiceId: string
  readonly entryId: string
  readonly bankAccountId: string
  readonly transactionId: string
  readonly batchId: string
  readonly documentId: string
  readonly inboxItemId: string
  readonly sourceId: string
  readonly snapshotId: string
}

const SELLER = {
  legalName: 'Test Beheer B.V.',
  street: 'Keizersgracht',
  houseNumber: '123-B',
  postalCode: '1015 CJ',
  city: 'Amsterdam',
  countryCode: 'NL',
  kvkNumber: '12345678',
  vatNumber: 'NL123456789B01',
}

async function anAdministration(label: string): Promise<Administration> {
  const entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)
  const { token } = await issueToken(database, {
    entityId,
    name: `isolation-${label}`,
    permissions: ['*'],
    actorKind: 'human',
    actorId: `human-${label}-${entityId.slice(0, 8)}`,
  })
  const at = (key?: string) => context(token, key)

  await handleUpdateEntity(await at(uuidv7()), updateEntityBody.parse(SELLER))

  const contact = await handleCreateContact(
    await at(uuidv7()),
    createContactBody.parse({
      number: `REL-${label}`,
      name: `Relatie ${label}`,
      email: `facturen@${label}.test`,
      vatNumber: 'NL987654321B01',
      isCustomer: true,
      isSupplier: true,
      iban: 'NL02ABNA0123456789',
      address: {
        street: 'Coolsingel',
        houseNumber: '42',
        postalCode: '3011 AD',
        city: 'Rotterdam',
      },
    }),
  )

  const drafted = await handleDraftInvoice(
    await at(uuidv7()),
    draftInvoiceBody.parse({
      contactNumber: `REL-${label}`,
      issueDate: '2026-03-01',
      buyerReference: `KP-${label}`,
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
  const invoiceId = (drafted.body as { id: string }).id
  await handleIssueInvoice(await at(uuidv7()), invoiceId, issueInvoiceBody.parse({}))

  const captured = await handleCapturePurchaseInvoice(
    await at(uuidv7()),
    capturePurchaseInvoiceBody.parse({
      contactNumber: `REL-${label}`,
      supplierInvoiceNumber: `F-${label}-0001`,
      invoiceDate: '2026-02-10',
      dueDate: '2026-03-12',
      net: '100000',
      tax: '21000',
      total: '121000',
      lines: [
        {
          description: 'Kantoorartikelen',
          accountNumber: '4000',
          taxCode: 'VH21',
          net: '100000',
          tax: '21000',
        },
      ],
    }),
  )
  const purchaseInvoiceId = captured.body.id
  await handleBookPurchaseInvoice(
    await at(uuidv7()),
    purchaseInvoiceId,
    bookPurchaseInvoiceBody.parse({}),
  )
  await handleTransitionPurchaseInvoice(
    await at(uuidv7()),
    purchaseInvoiceId,
    transitionPurchaseInvoiceBody.parse({ action: 'approve' }),
  )

  const posted = await handlePostJournalEntry(
    await at(uuidv7()),
    postJournalEntryBody.parse({
      journalCode: 'MEM',
      bookingDate: '2026-03-15',
      documentDate: '2026-03-15',
      description: `Memoriaal ${label}`,
      lines: [
        { accountNumber: '4000', debit: '10000' },
        { accountNumber: '1000', credit: '10000' },
      ],
    }),
  )
  const entryId = (posted.body as { entry: { id: string } }).entry.id

  const account = await handleCreateBankAccount(
    await at(uuidv7()),
    createBankAccountBody.parse({
      iban: 'NL20INGB0001234567',
      name: 'Rekening-courant',
      ledgerAccountNumber: '1100',
    }),
  )
  const bankAccountId = (account.body as { id: string }).id

  await handleImportStatement(
    await at(uuidv7()),
    importStatementBody.parse({
      bankAccountId,
      content: [
        `:20:STMT-${label}`,
        ':25:NL20INGB0001234567',
        ':28C:1/1',
        ':60F:C260401EUR0,00',
        `:61:2604020402C1210,00NTRFNONREF//REF-${label}`,
        `:86:betaling ${label}`,
        ':62F:C260402EUR1210,00',
        '-',
      ].join('\n'),
    }),
  )
  const transactions = await handleListBankTransactions(
    await at(),
    transactionsQuery.parse({ bankAccountId, limit: 10 }),
  )
  const transactionId = transactions.body.transactions[0]!.id

  const batch = await handleCreateBatch(
    await at(uuidv7()),
    createBatchBody.parse({
      reference: `BETAAL-${label}`,
      bankAccountId,
      requestedExecutionDate: '2026-05-01',
    }),
  )
  const batchId = (batch.body as { id: string }).id

  const received = await handleReceiveDocument(await at(uuidv7()), {
    bytes: new TextEncoder().encode(`%PDF-1.7 ${label} ${RUN}`),
    filename: `bon-${label}.pdf`,
    contentType: 'application/pdf',
    source: 'upload',
    receivedFrom: null,
    subject: null,
  })

  const source = await handleAddInboundSource(
    await at(uuidv7()),
    addInboundSourceBody.parse({
      kind: 'maildir',
      name: `Postvak ${label}`,
      directory: join(documentDirectory, `drop-${label}`),
    }),
  )

  const snapshot = await handleSealSnapshot(
    await at(uuidv7()),
    sealSnapshotBody.parse({ fiscalYear: '2026' }),
  )

  // An Exact connection, built through the repository rather than through the
  // handlers: the handlers talk to Exact, and this file is about scoping rather
  // than about OAuth. What matters is that the row exists and holds a secret.
  await withExactConnection(database, async (repository) => {
    await repository.upsertApp({
      entityId,
      baseUrl: 'https://start.exactonline.nl',
      clientId: `client-${label}`,
      clientSecret: `secret-of-${label}`,
      redirectUri: 'https://klopt.test/exact/callback',
    })
    await repository.storeTokens({
      entityId,
      accessToken: `access-of-${label}`,
      refreshToken: `refresh-of-${label}`,
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    await repository.chooseDivision({
      entityId,
      code: label === 'a' ? 1000 : 2000,
      name: `Administratie ${label}`,
      cautions: [],
    })
  })

  return {
    entityId,
    token,
    contactId: (contact.body as { id: string }).id,
    invoiceId,
    purchaseInvoiceId,
    entryId,
    bankAccountId,
    transactionId,
    batchId,
    documentId: received.body.documentId,
    inboxItemId: received.body.id,
    sourceId: (source.body as { id: string }).id,
    snapshotId: (snapshot.body as { id: string }).id,
  }
}

let a: Administration
let b: Administration

beforeAll(async () => {
  // The Exact connection in each fixture holds an encrypted client secret.
  process.env['KLOPT_ENCRYPTION_KEY'] ??= 'test-key-not-for-production-0123456789'
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)

  documentDirectory = await mkdtemp(join(tmpdir(), 'klopt-isolation-'))
  setDocumentStoreForTest(createFilesystemDocumentStore({ directory: documentDirectory }))

  a = await anAdministration('a')
  b = await anAdministration('b')
}, 120_000)

afterAll(async () => {
  // Take away the fixtures that would otherwise keep the worker busy.
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  setDocumentStoreForTest(null)
  await closeDatabase(database)
  await rm(documentDirectory, { recursive: true, force: true })
})

describe('a list shows one administration only its own rows', () => {
  it('across every list surface', async () => {
    const at = await context(a.token)

    // Named rather than counted: an assertion on a count would pass if the
    // wrong row of the right number leaked.
    const lists: readonly [string, () => Promise<readonly string[]>][] = [
      [
        'contacts',
        async () =>
          (
            await handleListContacts(at, contactsQuery.parse({ customersOnly: 'false' }))
          ).body.contacts.map((row) => row.number),
      ],
      [
        'sales invoices',
        async () =>
          (await handleListInvoices(at, invoicesQuery.parse({}))).body.invoices.map(
            (row) => row.contactName,
          ),
      ],
      [
        'purchase invoices',
        async () =>
          (
            await handleListPurchaseInvoices(at, listPurchaseInvoicesQuery.parse({}))
          ).body.invoices.map((row) => row.supplierInvoiceNumber),
      ],
      [
        'bank accounts',
        async () => (await handleListBankAccounts(at)).body.accounts.map((row) => row.id),
      ],
      [
        'bank transactions',
        async () =>
          (
            await handleListBankTransactions(
              at,
              transactionsQuery.parse({ bankAccountId: a.bankAccountId, limit: 100 }),
            )
          ).body.transactions.map((row) => row.id),
      ],
      [
        'payment batches',
        async () => (await handleListBatches(at)).body.batches.map((row) => row.reference),
      ],
      [
        'inbox',
        async () => (await handleListInbox(at, {})).body.items.map((row) => row.filename ?? ''),
      ],
      [
        'inbound sources',
        async () => (await handleListInboundSources(at)).body.sources.map((row) => row.name),
      ],
      [
        'snapshots',
        async () => (await handleListSnapshots(at)).body.snapshots.map((row) => row.id),
      ],
      [
        'audit log',
        async () =>
          (await handleListAuditLog(at, auditLogQuery.parse({}))).body.entries.map(
            (row) => row.resourceId,
          ),
      ],
      [
        'documents under retention',
        async () =>
          (await handleGetRetention(at, retentionQuery.parse({}))).body.documents.map(
            (row) => row.id,
          ),
      ],
    ]

    const bsThings = [
      b.contactId,
      b.invoiceId,
      b.purchaseInvoiceId,
      b.entryId,
      b.bankAccountId,
      b.transactionId,
      b.batchId,
      b.documentId,
      b.sourceId,
      b.snapshotId,
      'REL-b',
      'Relatie b',
      'F-b-0001',
      'BETAAL-b',
      'bon-b.pdf',
      'Postvak b',
    ]

    for (const [what, read] of lists) {
      const values = await read()
      expect(values.length, `${what} returned nothing, so it proves nothing`).toBeGreaterThan(0)

      for (const leaked of bsThings) {
        expect(values, `${what} leaked ${leaked} from the other administration`).not.toContain(
          leaked,
        )
      }
    }
  })
})

describe('a lookup by id refuses the other administration’s id', () => {
  /**
   * Every read handler that takes an id.
   *
   * This is the list that matters. A missing scope on a list is loud; a missing
   * scope here hands over one row at a time to anybody who has ever seen an id,
   * and the screen looks perfectly normal while it happens.
   */
  const lookups: readonly [string, (token: string, other: Administration) => Promise<unknown>][] = [
    [
      'journal entry',
      async (token, other) => handleGetJournalEntry(await context(token), other.entryId),
    ],
    ['contact', async (token, other) => handleGetContact(await context(token), other.contactId)],
    [
      'sales invoice',
      async (token, other) => handleGetInvoice(await context(token), other.invoiceId),
    ],
    [
      'sales invoice UBL',
      async (token, other) => handleGetInvoiceUbl(await context(token), other.invoiceId),
    ],
    [
      'sales invoice PDF',
      async (token, other) =>
        handleGetInvoicePdf(await context(token), other.invoiceId, { embedUbl: false }),
    ],
    [
      'purchase invoice',
      async (token, other) =>
        handleGetPurchaseInvoice(await context(token), other.purchaseInvoiceId),
    ],
    [
      'match suggestions',
      async (token, other) => handleSuggestMatches(await context(token), other.transactionId),
    ],
    ['payment batch', async (token, other) => handleGetBatch(await context(token), other.batchId)],
    [
      'payment run preview',
      async (token, other) => handlePreviewPaymentRun(await context(token), other.batchId),
    ],
    [
      'pain.001',
      async (token, other) => handleGetBatchPain001(await context(token), other.batchId),
    ],
    ['document', async (token, other) => handleGetDocument(await context(token), other.documentId)],
    [
      'snapshot manifest',
      async (token, other) => handleGetSnapshotManifest(await context(token), other.snapshotId),
    ],
  ]

  it('answers empty rather than refusing for a list under another’s parent', async () => {
    // Not every by-id read is a lookup. `deliveriesFor` is a *list* scoped by
    // both the entity and the invoice, so the right answer for somebody else's
    // invoice is no deliveries — the same answer as for an invoice with none.
    // That is not a leak, and asserting `not_found` here would have been
    // asserting an inconsistency rather than a property.
    const own = await handleListDeliveries(await context(a.token), a.invoiceId)
    const theirs = await handleListDeliveries(await context(a.token), b.invoiceId)

    expect(theirs.body.deliveries).toEqual([])
    // And the scope is real rather than the invoice simply having none: both
    // administrations issued an invoice the same way.
    expect(own.body.deliveries).toEqual([])
  })

  it.each(lookups.map(([what]) => what))('refuses %s', async (what) => {
    const [, read] = lookups.find(([name]) => name === what)!

    // `not_found` rather than `forbidden`, deliberately: telling somebody an id
    // exists but is not theirs confirms it exists.
    await expect(read(a.token, b)).rejects.toMatchObject({ code: 'not_found' })
    await expect(read(b.token, a)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('a write refuses the other administration’s id', () => {
  it('will not change, discard, poll or verify what is not its own', async () => {
    // The same property on the writing side. A leak here is worse than a read:
    // it lets one administration alter another's books.
    await expect(
      handleUpdateContact(
        await context(a.token, uuidv7()),
        b.contactId,
        updateContactBody.parse({ name: 'Overgenomen' }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })

    await expect(
      handleTransitionPurchaseInvoice(
        await context(a.token, uuidv7()),
        b.purchaseInvoiceId,
        transitionPurchaseInvoiceBody.parse({ action: 'dispute', reason: 'Niet mijn factuur.' }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })

    await expect(
      handleDiscardInboxItem(
        await context(a.token, uuidv7()),
        b.inboxItemId,
        discardInboxItemBody.parse({ reason: 'Niet mijn post.' }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })

    await expect(
      handlePollInboundSource(await context(a.token, uuidv7()), b.sourceId),
    ).rejects.toMatchObject({ code: 'not_found' })

    await expect(
      handleVerifySnapshot(
        await context(a.token, uuidv7()),
        b.snapshotId,
        verifySnapshotQuery.parse({}),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('keeps its own settings to itself', async () => {
    // Entity-level settings are the subtle case: there is no id in the call at
    // all, so a wrong scope would be silent.
    await handleUpdateEntity(
      await context(a.token, uuidv7()),
      updateEntityBody.parse({ legalName: 'Alleen van A B.V.' }),
    )

    expect((await handleGetEntity(await context(a.token))).body?.legalName).toBe(
      'Alleen van A B.V.',
    )
    expect((await handleGetEntity(await context(b.token))).body?.legalName).toBe('Test Beheer B.V.')
  })
})

describe('the credential path', () => {
  it('will not hand over another administration’s Exact credentials', async () => {
    // The second query in the codebase that returns a secret. Scoped in the
    // `where`, like the first, so no caller has to remember a check.
    const forA = await withExactConnection(database, (repository) =>
      repository.withCredentials(a.entityId),
    )
    const forB = await withExactConnection(database, (repository) =>
      repository.withCredentials(b.entityId),
    )

    expect(forA?.clientSecret).toBe('secret-of-a')
    expect(forB?.clientSecret).toBe('secret-of-b')

    // And what a screen reads shows one administration its own division only.
    const seenByA = await handleGetExactConnection(await context(a.token))
    const seenByB = await handleGetExactConnection(await context(b.token))

    expect(seenByA.body.connection?.divisionCode).toBe(1000)
    expect(seenByB.body.connection?.divisionCode).toBe(2000)
    expect(JSON.stringify(seenByA.body)).not.toContain('secret-of-')
  })

  it('will not hand over another administration’s mailbox password', async () => {
    // The one query in the codebase that returns a secret. It used to be scoped
    // by the caller comparing afterwards, which worked and was the wrong shape:
    // a method returning a password should not trust every future caller to
    // remember a check.
    await expect(
      handlePollInboundSource(await context(a.token, uuidv7()), b.sourceId),
    ).rejects.toMatchObject({ code: 'not_found' })

    const listed = await handleListInboundSources(await context(a.token))
    expect(JSON.stringify(listed.body)).not.toContain('Postvak b')
  })
})
