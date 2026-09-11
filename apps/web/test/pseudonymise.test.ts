import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { bankTransactionAllocations, bankTransactions } from '@klopt/db/schema'
import { cleanupSeededBackgroundWork, seedEntity, seedSalesConfiguration } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { ApiError } from '../src/api/errors.js'
import { handleListAuditLog } from '../src/api/handlers/audit.js'
import { handleGetJournalEntry } from '../src/api/handlers/ledger.js'
import { handlePseudonymiseContact } from '../src/api/handlers/retention.js'
import {
  handleCreateContact,
  handleDraftInvoice,
  handleGetInvoice,
  handleGetInvoiceUbl,
  handleIssueInvoice,
  handleListContacts,
} from '../src/api/handlers/sales.js'
import { handleCreateBankAccount } from '../src/api/handlers/bank.js'
import { handleUpdateEntity } from '../src/api/handlers/setup.js'
import {
  createBankAccountBody,
  createContactBody,
  draftInvoiceBody,
  issueInvoiceBody,
  pseudonymiseContactBody,
} from '../src/api/schemas.js'

/**
 * Answering a right-to-erasure request (spec 7.6).
 *
 * The claim this file has to make good on is narrow and load-bearing: erasing
 * a contact removes the address book entry and leaves the books exactly as
 * they were. If the invoice stopped naming its buyer, or the journal moved,
 * the erasure would have falsified statutory records — which is the failure
 * ADR 0030 says a delete button must never be able to cause.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let entityId: string
let token: string
let bankAccountId: string

const contextFor = async (idempotencyKey?: string) => {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return resolveRequestContext({
    database,
    request: new Request('https://klopt.test/api/v1/contacts', { headers }),
  })
}

async function aCustomer(): Promise<{ number: string; id: string }> {
  const number = `DEB-${randomUUID().slice(0, 8)}`
  await handleCreateContact(
    await contextFor(uuidv7()),
    createContactBody.parse({
      number,
      name: 'Jan de Vries Advies',
      isCustomer: true,
      kvkNumber: '87654321',
      vatNumber: 'NL987654321B01',
      countryCode: 'NL',
      email: 'jan@devries.nl',
      phone: '0612345678',
      iban: 'NL91ABNA0417164300',
      notes: 'Belt altijd op vrijdagmiddag.',
      address: {
        street: 'Coolsingel',
        houseNumber: '42',
        postalCode: '3011 AD',
        city: 'Rotterdam',
        countryCode: 'NL',
      },
    }),
  )

  const contacts = await handleListContacts(await contextFor(), { customersOnly: false })
  const created = contacts.body.contacts.find((row) => row.number === number)
  if (created === undefined) throw new Error('The contact was not created.')
  return { number, id: created.id }
}

async function anIssuedInvoice(contactNumber: string): Promise<string> {
  const draft = await handleDraftInvoice(
    await contextFor(uuidv7()),
    draftInvoiceBody.parse({
      contactNumber,
      issueDate: '2026-03-15',
      buyerReference: 'KOSTENPLAATS-42',
      lines: [
        {
          description: 'Advieswerk maart 2026',
          quantity: '1',
          unitCode: 'HUR',
          unitPrice: '10000',
          revenueAccountNumber: '8000',
          taxCode: 'H21',
        },
      ],
    }),
  )

  const invoiceId = (draft.body as { id: string }).id
  await handleIssueInvoice(await contextFor(uuidv7()), invoiceId, issueInvoiceBody.parse({}))
  return invoiceId
}

/**
 * Mark an invoice paid, without going through the bank screens.
 *
 * "Open" means issued and not fully allocated, and an allocation hangs off a
 * bank transaction. Importing a statement and matching it is a well-covered
 * path in `matching.test.ts`; replaying it here would make this file about
 * banking. The subject is what an erasure does to the books, so the row goes
 * in directly and the comment says so.
 */
async function settle(invoiceId: string, amount: string): Promise<void> {
  const transactionId = uuidv7()
  await database.insert(bankTransactions).values({
    id: transactionId,
    entityId,
    bankAccountId,
    dedupeKey: transactionId,
    amountMinorUnits: BigInt(amount),
    currency: 'EUR',
    bookingDate: '2026-04-01',
    valueDate: '2026-04-01',
  })
  await database.insert(bankTransactionAllocations).values({
    id: uuidv7(),
    entityId,
    transactionId,
    invoiceId,
    amountMinorUnits: BigInt(amount),
  })
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)

  entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)

  const issued = await issueToken(database, {
    entityId,
    name: 'pseudonymise-test',
    permissions: ['*'],
    actorKind: 'script',
    actorId: 'test',
  })
  token = issued.token

  // A seller complete enough to produce a UBL, so the assertion below is about
  // the buyer rather than about a missing address on our own side.
  await handleUpdateEntity(await contextFor(uuidv7()), {
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

  const account = await handleCreateBankAccount(
    await contextFor(uuidv7()),
    createBankAccountBody.parse({
      iban: `NL${String(Date.now()).slice(-2)}TEST${String(Date.now()).slice(-10)}`,
      name: 'Rekening-courant',
      ledgerAccountNumber: '1100',
    }),
  )
  bankAccountId = (account.body as { id: string }).id
}, 60_000)

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('erasing a contact', () => {
  it('is refused while an invoice is still open, and says why', async () => {
    const customer = await aCustomer()
    await anIssuedInvoice(customer.number)

    await expect(
      handlePseudonymiseContact(
        await contextFor(uuidv7()),
        customer.id,
        pseudonymiseContactBody.parse({ reason: 'Verzoek tot verwijdering' }),
      ),
    ).rejects.toThrow(ApiError)
  })

  it('erases the address book and leaves the books exactly as they were', async () => {
    const customer = await aCustomer()
    const invoiceId = await anIssuedInvoice(customer.number)

    // What the invoice said before, and the entry it posted.
    const before = await handleGetInvoice(await contextFor(), invoiceId)
    const entryId = before.body.invoice.journalEntryId as string
    const entryBefore = await handleGetJournalEntry(await contextFor(), entryId)
    const ublBefore = await handleGetInvoiceUbl(await contextFor(), invoiceId)
    expect(ublBefore.xml).toContain('Jan de Vries Advies')

    // Settle it, so the refusal above does not stand in the way.
    await settle(invoiceId, before.body.invoice.total)

    const erased = await handlePseudonymiseContact(
      await contextFor(uuidv7()),
      customer.id,
      pseudonymiseContactBody.parse({ reason: 'Verzoek tot verwijdering, 1 april' }),
    )
    expect(erased.body.name).toBe(`Gewist contact ${customer.number}`)

    // The address book is gone.
    const contacts = await handleListContacts(await contextFor(), { customersOnly: false })
    const row = contacts.body.contacts.find((entry) => entry.id === customer.id)!
    expect(row.name).toBe(`Gewist contact ${customer.number}`)
    expect(row.email).toBeNull()
    expect(row.isBlocked).toBe(true)

    // The invoice still names the person it was issued to. This is the whole
    // claim: the bewaarplicht is satisfied because the invoice took its own
    // copy, not because the contact row was left alone.
    const ublAfter = await handleGetInvoiceUbl(await contextFor(), invoiceId)
    expect(ublAfter.xml).toContain('Jan de Vries Advies')
    expect(ublAfter.xml).toContain('Coolsingel')

    // And the journal has not moved a cent.
    const entryAfter = await handleGetJournalEntry(await contextFor(), entryId)
    expect(entryAfter.body.entry.hash).toBe(entryBefore.body.entry.hash)
    expect(entryAfter.body.entry.lines).toEqual(entryBefore.body.entry.lines)
  })

  it('writes down what was erased, which is what a supervisory authority asks for', async () => {
    const customer = await aCustomer()
    await handlePseudonymiseContact(
      await contextFor(uuidv7()),
      customer.id,
      pseudonymiseContactBody.parse({ reason: 'Verzoek per e-mail' }),
    )

    const log = await handleListAuditLog(await contextFor(), {
      resourceType: 'contact',
      limit: 200,
    })
    const entry = log.body.entries.find(
      (row) => row.resourceId === customer.id && row.action === 'retention.pseudonymiseContact',
    )

    expect(entry).toBeDefined()
    expect((entry?.before as { email?: string } | null)?.email).toBe('jan@devries.nl')
    expect((entry?.after as { reason?: string } | null)?.reason).toBe('Verzoek per e-mail')
  })

  it('runs a second time without changing anything, so a retry is safe', async () => {
    const customer = await aCustomer()
    const first = await handlePseudonymiseContact(
      await contextFor(uuidv7()),
      customer.id,
      pseudonymiseContactBody.parse({ reason: 'Eerste verzoek' }),
    )
    const second = await handlePseudonymiseContact(
      await contextFor(uuidv7()),
      customer.id,
      pseudonymiseContactBody.parse({ reason: 'Nog een keer' }),
    )

    expect(second.body.name).toBe(first.body.name)
  })
})
