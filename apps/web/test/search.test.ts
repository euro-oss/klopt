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
import { handleSearch } from '../src/api/handlers/search.js'
import { handleReceiveDocument } from '../src/api/handlers/inbox.js'
import { handlePostJournalEntry } from '../src/api/handlers/ledger.js'
import { handleCapturePurchaseInvoice } from '../src/api/handlers/purchase.js'
import {
  handleCreateContact,
  handleDraftInvoice,
  handleIssueInvoice,
} from '../src/api/handlers/sales.js'
import {
  capturePurchaseInvoiceBody,
  createContactBody,
  draftInvoiceBody,
  issueInvoiceBody,
  postJournalEntryBody,
  searchQuery,
} from '../src/api/schemas.js'

/**
 * One entry point across invoices, contacts, entries and documents (spec 10.3).
 *
 * Two properties carry the weight. The first is that a hit says where to read
 * the whole thing: "provenance is mandatory", and a search result an agent
 * cannot follow is a paraphrase waiting to happen. The second is that the
 * search is scoped to the administration the token is for — a search that
 * leaked across entities would be the one place multi-entity isolation is
 * easiest to get wrong, because every other read starts from an id that came
 * from somewhere.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let documentDirectory: string
let token: string
let otherToken: string

const context = (bearer: string) =>
  resolveRequestContext({
    database,
    request: new Request('https://klopt.test/api/v1/search', {
      headers: new Headers({
        authorization: `Bearer ${bearer}`,
        'idempotency-key': uuidv7(),
      }),
    }),
  })

const find = async (query: Record<string, unknown>, bearer = token) =>
  (await handleSearch(await context(bearer), searchQuery.parse(query))).body

async function newEntity(name: string) {
  const entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)
  const { token: issued } = await issueToken(database, {
    entityId,
    name,
    permissions: ['*'],
    actorKind: 'human',
    actorId: `human-${entityId.slice(0, 8)}`,
  })
  return issued
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
  documentDirectory = mkdtempSync(join(tmpdir(), 'klopt-search-'))
  setDocumentStoreForTest(createFilesystemDocumentStore({ directory: documentDirectory }))

  token = await newEntity('search-test')
  otherToken = await newEntity('search-test-other')

  // A customer, a supplier, and a third contact whose name is a substring of
  // nothing anybody will search for.
  await handleCreateContact(
    await context(token),
    createContactBody.parse({
      number: 'DEB-0001',
      name: 'Zeewaardig Advies B.V.',
      email: 'administratie@zeewaardig.test',
      vatNumber: 'NL123456789B01',
    }),
  )
  await handleCreateContact(
    await context(token),
    createContactBody.parse({
      number: 'CRE-0001',
      name: 'Kantoorgigant B.V.',
      isCustomer: false,
      isSupplier: true,
      vatNumber: 'NL987654321B01',
    }),
  )
  await handleCreateContact(
    await context(token),
    createContactBody.parse({ number: 'DEB-0002', name: 'Vijftig procent 50% korting' }),
  )

  const drafted = await handleDraftInvoice(
    await context(token),
    draftInvoiceBody.parse({
      contactNumber: 'DEB-0001',
      issueDate: '2026-01-20',
      reference: 'Zeewaardig kwartaal 1',
      lines: [
        {
          description: 'Advieswerkzaamheden',
          quantity: '10',
          unitPrice: '10000',
          revenueAccountNumber: '8000',
          taxCode: 'H21',
        },
      ],
    }),
  )
  await handleIssueInvoice(
    await context(token),
    (drafted.body as { id: string }).id,
    issueInvoiceBody.parse({}),
  )

  await handleCapturePurchaseInvoice(
    await context(token),
    capturePurchaseInvoiceBody.parse({
      contactNumber: 'CRE-0001',
      supplierInvoiceNumber: 'F-2026-0042',
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

  await handlePostJournalEntry(
    await context(token),
    postJournalEntryBody.parse({
      journalCode: 'MEM',
      bookingDate: '2026-03-15',
      documentDate: '2026-03-15',
      description: 'Herrubricering zeewaardig',
      lines: [
        { accountNumber: '8000', debit: '5000' },
        { accountNumber: '1300', credit: '5000' },
      ],
    }),
  )

  await handleReceiveDocument(await context(token), {
    bytes: new TextEncoder().encode('<Invoice/>'),
    filename: 'zeewaardig-kwartaal.xml',
    contentType: 'application/xml',
    source: 'upload',
    receivedFrom: 'administratie@zeewaardig.test',
    subject: 'Factuur kwartaal 1',
  })
}, 120_000)

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  setDocumentStoreForTest(null)
  setDatabaseForTest(null)
  rmSync(documentDirectory, { recursive: true, force: true })
  await closeDatabase(database)
})

describe('searching an administration', () => {
  it('reaches all five resources from one word', async () => {
    const body = await find({ q: 'zeewaardig' })

    // The contact, its invoice, the entry that mentions it, and the document
    // that arrived from it. The purchase invoice is from somebody else.
    expect(new Set(body.results.map((hit) => hit.type))).toEqual(
      new Set(['contact', 'sales-invoice', 'journal-entry', 'document']),
    )
    expect(body.counts['purchase-invoice']).toBe(0)
  })

  it('gives every hit the path that reads it in full', async () => {
    // Provenance, which is the rule the whole tool design rests on: a number
    // with no drill-down path is how an agent ends up confidently wrong.
    const body = await find({ q: 'zeewaardig' })

    expect(body.results.length).toBeGreaterThan(0)
    for (const hit of body.results) {
      expect(hit.path).toMatch(/^\/[a-z-]+\/[0-9a-f-]{36}$/)
      expect(hit.path.endsWith(hit.id)).toBe(true)
    }
  })

  it('puts an exact identifier first, whichever resource it lives in', async () => {
    const body = await find({ q: 'F-2026-0042' })

    expect(body.results[0]?.type).toBe('purchase-invoice')
    expect(body.results[0]?.rank).toBe(0)
    expect(body.results[0]?.amountMinorUnits).toBe('121000')
    expect(body.results[0]?.currency).toBe('EUR')
  })

  it('treats a percent sign as a character, not as a wildcard', async () => {
    /**
     * The bug this prevents: `%` reaching LIKE unescaped, so a search for a
     * discount matches the entire administration and the agent summarises a
     * list that means nothing.
     */
    const literal = await find({ q: '50%' })
    expect(literal.results.map((hit) => hit.title)).toEqual([
      'DEB-0002 Vijftig procent 50% korting',
    ])

    const everything = await find({ q: 'e' + '%', types: 'contact' })
    expect(everything.results).toHaveLength(0)
  })

  it('searches only the administration the token is for', async () => {
    const mine = await find({ q: 'zeewaardig' })
    expect(mine.results.length).toBeGreaterThan(0)

    const theirs = await find({ q: 'zeewaardig' }, otherToken)
    expect(theirs.results).toHaveLength(0)
  })

  it('narrows to the named resources and says which it looked in', async () => {
    const body = await find({ q: 'zeewaardig', types: 'contact,document' })

    expect(body.types).toEqual(['contact', 'document'])
    expect(new Set(body.results.map((hit) => hit.type))).toEqual(new Set(['contact', 'document']))
  })

  it('says when a list is cut short rather than leaving it to be inferred', async () => {
    const body = await find({ q: 'B.V.', types: 'contact', limit: 1 })

    expect(body.results).toHaveLength(1)
    expect(body.truncated).toEqual(['contact'])
  })

  it('refuses a single character', () => {
    // One letter matches most of an administration, and that is not an answer.
    expect(searchQuery.safeParse({ q: 'z' }).success).toBe(false)
    expect(searchQuery.safeParse({ q: 'ze' }).success).toBe(true)
  })
})
