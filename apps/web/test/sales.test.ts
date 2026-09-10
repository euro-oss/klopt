import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import {
  handleCreateContact,
  handleDraftInvoice,
  handleGetInvoice,
  handleIssueInvoice,
  handleListContacts,
  handleListInvoices,
  handleListOverdueInvoices,
  handleListTaxCodes,
  handleGetContact,
  handleUpdateContact,
} from '../src/api/handlers/sales.js'
import {
  handleBookPurchaseInvoice,
  handleCapturePurchaseInvoice,
} from '../src/api/handlers/purchase.js'
import { handleGetProfitAndLoss, handleGetBalanceSheet } from '../src/api/handlers/compliance.js'
import { handleGetJournalEntry } from '../src/api/handlers/ledger.js'
import {
  bookPurchaseInvoiceBody,
  capturePurchaseInvoiceBody,
  createContactBody,
  draftInvoiceBody,
  issueInvoiceBody,
  updateContactBody,
} from '../src/api/schemas.js'

/**
 * Invoicing, end to end.
 *
 * The assertion that matters is the last one in each block: an invoice is only
 * real if it reaches the ledger, and the ledger is only right if the statements
 * move by exactly the invoice's amount.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database

function request(token: string, idempotencyKey?: string): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/x', { headers })
}

const context = (token: string, key?: string) =>
  resolveRequestContext({ database, request: request(token, key) })

async function newEntity(rounding: 'per_invoice' | 'per_line' = 'per_invoice') {
  const entityId = await seedEntity(database, { vatRounding: rounding })
  await seedSalesConfiguration(database, entityId)
  const { token } = await issueToken(database, {
    entityId,
    name: 'sales-test',
    permissions: ['*'],
    actorKind: 'script',
    actorId: 'sales-test',
  })
  return { entityId, token }
}

async function withCustomer(token: string, number = 'DEB-0001') {
  await handleCreateContact(
    await context(token, uuidv7()),
    createContactBody.parse({
      number,
      name: 'Klant B.V.',
      email: 'facturen@klant.test',
      vatNumber: 'NL987654321B01',
      paymentTermsDays: 30,
    }),
  )
  return number
}

const draft = (overrides: Record<string, unknown> = {}) =>
  draftInvoiceBody.parse({
    contactNumber: 'DEB-0001',
    issueDate: '2026-01-20',
    lines: [
      {
        description: 'Advieswerkzaamheden',
        quantity: '10',
        unitPrice: '10000',
        revenueAccountNumber: '8000',
        taxCode: 'H21',
      },
    ],
    ...overrides,
  })

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
}, 60_000)

afterAll(async () => {
  // Take away the fixtures that would otherwise keep the worker busy.
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('contacts', () => {
  it('creates one and lists it', async () => {
    const { token } = await newEntity()
    await withCustomer(token)

    const result = await handleListContacts(await context(token), { customersOnly: true })
    expect(result.body.contacts).toHaveLength(1)
    expect(result.body.contacts[0]?.name).toBe('Klant B.V.')
    expect(result.body.contacts[0]?.paymentTermsDays).toBe(30)
  })

  it('needs ledger:configure', async () => {
    const entityId = await seedEntity(database)
    const { token } = await issueToken(database, {
      entityId,
      name: 'read',
      permissions: ['ledger:read'],
      actorKind: 'script',
      actorId: 'x',
    })

    await expect(
      handleCreateContact(
        await context(token, uuidv7()),
        createContactBody.parse({ number: 'X', name: 'X' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('tax codes', () => {
  it('reports the rate as a percentage as well as basis points', async () => {
    const { token } = await newEntity()
    const result = await handleListTaxCodes(await context(token))

    const high = result.body.taxCodes.find((code) => code.code === 'H21')
    expect(high?.rateBasisPoints).toBe(2100)
    expect(high?.ratePercent).toBe('21.00')
    expect(high?.accountNumber).toBe('1500')
  })
})

describe('drafting', () => {
  it('prices the draft without posting anything', async () => {
    const { token } = await newEntity()
    await withCustomer(token)

    const result = await handleDraftInvoice(await context(token, uuidv7()), draft())

    expect(result.status).toBe(201)
    expect(result.body.status).toBe('draft')
    expect(result.body.net).toBe('100000')
    expect(result.body.tax).toBe('21000')
    expect(result.body.total).toBe('121000')

    // No number, no entry: a draft is not an invoice.
    const fetched = await handleGetInvoice(await context(token), result.body.id)
    expect(fetched.body.invoice.number).toBeNull()
    expect(fetched.body.invoice.journalEntryId).toBeNull()

    // And the books have not moved.
    const statement = await handleGetProfitAndLoss(await context(token), {
      fiscalYear: '2026',
      fromPeriod: 1,
      toPeriod: 13,
      currency: 'EUR',
    })
    expect(statement.body.result).toBe('0')
  })

  it('sets the due date from the contact’s payment terms', async () => {
    const { token } = await newEntity()
    await withCustomer(token)

    const result = await handleDraftInvoice(await context(token, uuidv7()), draft())
    const fetched = await handleGetInvoice(await context(token), result.body.id)

    expect(fetched.body.invoice.issueDate).toBe('2026-01-20')
    expect(fetched.body.invoice.dueDate).toBe('2026-02-19')
  })

  it('refuses an unknown contact', async () => {
    const { token } = await newEntity()
    await expect(
      handleDraftInvoice(await context(token, uuidv7()), draft({ contactNumber: 'NOPE' })),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses a revenue account that does not exist', async () => {
    const { token } = await newEntity()
    await withCustomer(token)

    await expect(
      handleDraftInvoice(
        await context(token, uuidv7()),
        draft({
          lines: [
            {
              description: 'x',
              quantity: '1',
              unitPrice: '100',
              revenueAccountNumber: '7777',
              taxCode: 'H21',
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('needs an idempotency key', async () => {
    const { token } = await newEntity()
    await withCustomer(token)
    await expect(handleDraftInvoice(await context(token), draft())).rejects.toMatchObject({
      code: 'idempotency_key_required',
    })
  })
})

describe('issuing', () => {
  it('numbers the invoice and posts it to the ledger', async () => {
    const { token } = await newEntity()
    await withCustomer(token)

    const drafted = await handleDraftInvoice(await context(token, uuidv7()), draft())
    const issued = await handleIssueInvoice(
      await context(token, uuidv7()),
      drafted.body.id,
      issueInvoiceBody.parse({}),
    )

    expect(issued.body.number).toBe('2026-0001')
    expect(issued.body.status).toBe('issued')
    expect(issued.body.journalEntryId).not.toBeNull()

    // The entry is an ordinary journal entry, with everything that implies.
    const entry = await handleGetJournalEntry(await context(token), issued.body.journalEntryId)
    expect(entry.body.entry.journalCode).toBe('VRK')
    expect(entry.body.entry.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(entry.body.entry.sourceDocumentRef).toBe('2026-0001')

    const receivable = entry.body.entry.lines.find((line) => line.accountNumber === '1300')
    expect(receivable?.debit).toBe('121000')
    // The subledger link: this is what the debtors ledger and M2's bank
    // matching are built on.
    expect(receivable?.subledgerKind).toBe('customer')
    expect(entry.body.entry.lines.find((line) => line.accountNumber === '8000')?.credit).toBe(
      '100000',
    )
    expect(entry.body.entry.lines.find((line) => line.accountNumber === '1500')?.credit).toBe(
      '21000',
    )
  })

  it('moves the statements by exactly the invoice', async () => {
    const { token } = await newEntity()
    await withCustomer(token)

    const drafted = await handleDraftInvoice(await context(token, uuidv7()), draft())
    await handleIssueInvoice(
      await context(token, uuidv7()),
      drafted.body.id,
      issueInvoiceBody.parse({}),
    )

    const query = { fiscalYear: '2026', fromPeriod: 1, toPeriod: 13, currency: 'EUR' }
    const statement = await handleGetProfitAndLoss(await context(token), query)
    const sheet = await handleGetBalanceSheet(await context(token), query)

    expect(statement.body.revenue.total).toBe('100000')
    expect(statement.body.result).toBe('100000')
    // Debtors up by the gross, BTW payable up by the tax, and it balances.
    expect(sheet.body.assets.lines.find((line) => line.accountNumber === '1300')?.amount).toBe(
      '121000',
    )
    expect(sheet.body.liabilities.lines.find((line) => line.accountNumber === '1500')?.amount).toBe(
      '21000',
    )
    expect(sheet.body.difference).toBe('0')
  })

  it('numbers gaplessly, per year', async () => {
    const { token } = await newEntity()
    await withCustomer(token)

    const numbers: string[] = []
    for (let index = 0; index < 3; index += 1) {
      const drafted = await handleDraftInvoice(await context(token, uuidv7()), draft())
      const issued = await handleIssueInvoice(
        await context(token, uuidv7()),
        drafted.body.id,
        issueInvoiceBody.parse({}),
      )
      numbers.push(issued.body.number)
    }

    expect(numbers).toEqual(['2026-0001', '2026-0002', '2026-0003'])
  })

  it('refuses to issue the same invoice twice', async () => {
    const { token } = await newEntity()
    await withCustomer(token)

    const drafted = await handleDraftInvoice(await context(token, uuidv7()), draft())
    await handleIssueInvoice(
      await context(token, uuidv7()),
      drafted.body.id,
      issueInvoiceBody.parse({}),
    )

    // Issued is final. A wrong invoice is corrected with a credit note.
    await expect(
      handleIssueInvoice(
        await context(token, uuidv7()),
        drafted.body.id,
        issueInvoiceBody.parse({}),
      ),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('does not burn a number when the posting fails', async () => {
    const { token } = await newEntity()
    await withCustomer(token)

    // No fiscal period covers 2019, so the posting is refused — and the whole
    // transaction rolls back, returning the number to the pool.
    const bad = await handleDraftInvoice(
      await context(token, uuidv7()),
      draft({ issueDate: '2019-05-01' }),
    )
    await expect(
      handleIssueInvoice(await context(token, uuidv7()), bad.body.id, issueInvoiceBody.parse({})),
    ).rejects.toMatchObject({ name: 'LedgerError' })

    const good = await handleDraftInvoice(await context(token, uuidv7()), draft())
    const issued = await handleIssueInvoice(
      await context(token, uuidv7()),
      good.body.id,
      issueInvoiceBody.parse({}),
    )
    expect(issued.body.number).toBe('2026-0001')
  })
})

describe('credit notes', () => {
  it('reverses the original, and the two net to nothing', async () => {
    const { token } = await newEntity()
    await withCustomer(token)

    const drafted = await handleDraftInvoice(await context(token, uuidv7()), draft())
    const original = await handleIssueInvoice(
      await context(token, uuidv7()),
      drafted.body.id,
      issueInvoiceBody.parse({}),
    )

    const creditDraft = await handleDraftInvoice(
      await context(token, uuidv7()),
      draft({ kind: 'credit_note', creditsInvoiceId: drafted.body.id }),
    )
    const credit = await handleIssueInvoice(
      await context(token, uuidv7()),
      creditDraft.body.id,
      issueInvoiceBody.parse({}),
    )

    expect(credit.body.number).toBe('CN2026-0002')

    const entry = await handleGetJournalEntry(await context(token), credit.body.journalEntryId)
    expect(entry.body.entry.lines.find((line) => line.accountNumber === '1300')?.credit).toBe(
      '121000',
    )

    const statement = await handleGetProfitAndLoss(await context(token), {
      fiscalYear: '2026',
      fromPeriod: 1,
      toPeriod: 13,
      currency: 'EUR',
    })
    expect(statement.body.result).toBe('0')
    void original
  })
})

describe('rounding policy reaches the invoice', () => {
  it('per_line and per_invoice give different tax on the same lines', async () => {
    const lines = Array.from({ length: 10 }, () => ({
      description: 'Cent',
      quantity: '1',
      unitPrice: '1',
      revenueAccountNumber: '8000',
      taxCode: 'H21',
    }))

    const perLine = await newEntity('per_line')
    await withCustomer(perLine.token)
    const a = await handleDraftInvoice(await context(perLine.token, uuidv7()), draft({ lines }))

    const perInvoice = await newEntity('per_invoice')
    await withCustomer(perInvoice.token)
    const b = await handleDraftInvoice(await context(perInvoice.token, uuidv7()), draft({ lines }))

    // 21% of a cent is 0.21 of a cent: nothing ten times, or two cents once.
    expect(a.body.tax).toBe('0')
    expect(b.body.tax).toBe('2')
    expect(a.body.rounding).toBe('per_line')
    expect(b.body.rounding).toBe('per_invoice')
  })
})

describe('listing and ageing', () => {
  it('lists by status', async () => {
    const { token } = await newEntity()
    await withCustomer(token)

    const drafted = await handleDraftInvoice(await context(token, uuidv7()), draft())
    await handleDraftInvoice(await context(token, uuidv7()), draft())
    await handleIssueInvoice(
      await context(token, uuidv7()),
      drafted.body.id,
      issueInvoiceBody.parse({}),
    )

    const drafts = await handleListInvoices(await context(token), { status: 'draft', limit: 100 })
    const issued = await handleListInvoices(await context(token), { status: 'issued', limit: 100 })

    expect(drafts.body.invoices).toHaveLength(1)
    expect(issued.body.invoices).toHaveLength(1)
    expect(issued.body.invoices[0]?.number).toBe('2026-0001')
  })

  it('ages overdue invoices, and ignores drafts', async () => {
    const { token } = await newEntity()
    await withCustomer(token)

    const drafted = await handleDraftInvoice(await context(token, uuidv7()), draft())
    await handleIssueInvoice(
      await context(token, uuidv7()),
      drafted.body.id,
      issueInvoiceBody.parse({}),
    )
    // A second invoice left as a draft: not owed, so not overdue.
    await handleDraftInvoice(await context(token, uuidv7()), draft())

    const overdue = await handleListOverdueInvoices(await context(token), { asOf: '2026-03-01' })

    expect(overdue.body.invoices).toHaveLength(1)
    expect(overdue.body.invoices[0]?.number).toBe('2026-0001')
    // Due 19 February, asked on 1 March.
    expect(overdue.body.invoices[0]?.daysOverdue).toBe(10)
    expect(overdue.body.totalOutstanding).toBe('121000')
  })

  it('reports nothing overdue before the due date', async () => {
    const { token } = await newEntity()
    await withCustomer(token)

    const drafted = await handleDraftInvoice(await context(token, uuidv7()), draft())
    await handleIssueInvoice(
      await context(token, uuidv7()),
      drafted.body.id,
      issueInvoiceBody.parse({}),
    )

    const overdue = await handleListOverdueInvoices(await context(token), { asOf: '2026-02-01' })
    expect(overdue.body.invoices).toEqual([])
    expect(overdue.body.totalOutstanding).toBe('0')
  })
})

describe('correcting a relatie', () => {
  /** The contact id, which `createContact` returns and the list confirms. */
  async function aContact(token: string, overrides: Record<string, unknown> = {}) {
    const created = await handleCreateContact(
      await context(token, uuidv7()),
      createContactBody.parse({
        number: 'DEB-0009',
        name: 'Typfout B.V.',
        email: 'info@typfout.test',
        isCustomer: true,
        isSupplier: true,
        ...overrides,
      }),
    )
    return (created.body as { id: string }).id
  }

  it('fixes a mistyped IBAN, which is the whole reason this exists', async () => {
    // A supplier whose IBAN cannot be corrected is a supplier who can never be
    // paid. There is no journal here to keep honest — this is master data.
    const { token } = await newEntity()
    const id = await aContact(token, { number: 'CRE-0009', iban: 'NL02ABNA012345678' })

    await handleUpdateContact(
      await context(token, uuidv7()),
      id,
      updateContactBody.parse({ iban: 'NL02ABNA0123456789' }),
    )

    const after = await handleGetContact(await context(token), id)
    expect(after.body.contact.iban).toBe('NL02ABNA0123456789')
    // And nothing else moved.
    expect(after.body.contact.name).toBe('Typfout B.V.')
    expect(after.body.contact.email).toBe('info@typfout.test')
  })

  it('writes only what was sent', async () => {
    const { token } = await newEntity()
    const id = await aContact(token, { vatNumber: 'NL987654321B01', paymentTermsDays: 14 })

    await handleUpdateContact(
      await context(token, uuidv7()),
      id,
      updateContactBody.parse({ name: 'Correcte Naam B.V.' }),
    )

    const after = await handleGetContact(await context(token), id)
    expect(after.body.contact.name).toBe('Correcte Naam B.V.')
    expect(after.body.contact.vatNumber).toBe('NL987654321B01')
    expect(after.body.contact.paymentTermsDays).toBe(14)
  })

  it('clears a field that is sent as null', async () => {
    const { token } = await newEntity()
    const id = await aContact(token, { kvkNumber: '12345678' })

    await handleUpdateContact(
      await context(token, uuidv7()),
      id,
      updateContactBody.parse({ kvkNumber: null }),
    )

    expect((await handleGetContact(await context(token), id)).body.contact.kvkNumber).toBeNull()
  })

  it('adds an address to a contact that had none, and then changes it', async () => {
    const { token } = await newEntity()
    const id = await aContact(token)

    expect((await handleGetContact(await context(token), id)).body.contact.address).toBeNull()

    await handleUpdateContact(
      await context(token, uuidv7()),
      id,
      updateContactBody.parse({
        address: {
          street: 'Keizersgracht',
          houseNumber: '1',
          postalCode: '1015 CJ',
          city: 'Amsterdam',
        },
      }),
    )

    await handleUpdateContact(
      await context(token, uuidv7()),
      id,
      updateContactBody.parse({
        address: {
          street: 'Herengracht',
          houseNumber: '2',
          postalCode: '1015 BR',
          city: 'Amsterdam',
        },
      }),
    )

    const after = await handleGetContact(await context(token), id)
    expect(after.body.contact.address).toMatchObject({
      street: 'Herengracht',
      houseNumber: '2',
      city: 'Amsterdam',
    })
  })

  it('refuses to unmark a supplier who still has open invoices', async () => {
    // Taking the role away would take them out of the payment run and the
    // ageing while the ledger still owes them — the subledger and its control
    // account would part company. Blocking is the thing that was meant.
    const { token } = await newEntity()
    await handleCreateContact(
      await context(token, uuidv7()),
      createContactBody.parse({
        number: 'CRE-0100',
        name: 'Leverancier B.V.',
        isCustomer: false,
        isSupplier: true,
      }),
    )

    const captured = await handleCapturePurchaseInvoice(
      await context(token, uuidv7()),
      capturePurchaseInvoiceBody.parse({
        contactNumber: 'CRE-0100',
        supplierInvoiceNumber: 'F-1',
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
    await handleBookPurchaseInvoice(
      await context(token, uuidv7()),
      captured.body.id,
      bookPurchaseInvoiceBody.parse({}),
    )

    const contacts = await handleListContacts(await context(token), { customersOnly: false })
    const supplier = contacts.body.contacts.find((row) => row.number === 'CRE-0100')!

    await expect(
      handleUpdateContact(
        await context(token, uuidv7()),
        supplier.id,
        updateContactBody.parse({ isSupplier: false }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })

    // Blocking is allowed, and is what was meant.
    await handleUpdateContact(
      await context(token, uuidv7()),
      supplier.id,
      updateContactBody.parse({ isBlocked: true }),
    )
    expect((await handleGetContact(await context(token), supplier.id)).body.contact.isBlocked).toBe(
      true,
    )
  })

  it('allows unmarking a supplier whose invoices are all paid', async () => {
    const { token } = await newEntity()
    const id = await aContact(token, { number: 'CRE-0101', isCustomer: false, isSupplier: true })

    await handleUpdateContact(
      await context(token, uuidv7()),
      id,
      updateContactBody.parse({ isSupplier: false }),
    )

    expect((await handleGetContact(await context(token), id)).body.contact.isSupplier).toBe(false)
  })

  it('refuses a number that another contact already has', async () => {
    const { token } = await newEntity()
    await withCustomer(token, 'DEB-0001')
    const second = await aContact(token, { number: 'DEB-0002' })

    await expect(
      handleUpdateContact(
        await context(token, uuidv7()),
        second,
        updateContactBody.parse({ number: 'DEB-0001' }),
      ),
    ).rejects.toThrow()
  })

  it('will not read another administration’s contact', async () => {
    const { token } = await newEntity()
    const other = await newEntity()
    const id = await aContact(other.token)

    await expect(handleGetContact(await context(token), id)).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('needs ledger:configure', async () => {
    const { entityId, token } = await newEntity()
    const id = await aContact(token)
    const { token: reader } = await issueToken(database, {
      entityId,
      name: 'reader',
      permissions: ['ledger:read'],
      actorKind: 'human',
      actorId: 'reader',
    })

    await expect(
      handleUpdateContact(
        await context(reader, uuidv7()),
        id,
        updateContactBody.parse({ name: 'Nope' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
