import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { handleExplainNumber } from '../src/api/handlers/explain.js'
import { handleGetProfitAndLoss } from '../src/api/handlers/compliance.js'
import { handleGetTrialBalance } from '../src/api/handlers/ledger.js'
import { handleGetVatReturn } from '../src/api/handlers/vat.js'
import {
  handleBookPurchaseInvoice,
  handleCapturePurchaseInvoice,
  handleGetCreditorAgeing,
} from '../src/api/handlers/purchase.js'
import {
  handleCreateContact,
  handleDraftInvoice,
  handleIssueInvoice,
} from '../src/api/handlers/sales.js'
import {
  bookPurchaseInvoiceBody,
  capturePurchaseInvoiceBody,
  createContactBody,
  creditorAgeingQuery,
  draftInvoiceBody,
  explainQuery,
  issueInvoiceBody,
  statementQuery,
  trialBalanceQuery,
} from '../src/api/schemas.js'

/**
 * Where a reported figure came from (spec 10.3).
 *
 * Every test here checks the explanation against the report that published the
 * figure, rather than against itself. An `explain` that agreed with its own
 * arithmetic and disagreed with the balance sheet would pass a test written
 * the easy way, and would be worse than useless — it would be a second,
 * confident, wrong number with a drill-down attached.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let token: string

const context = () =>
  resolveRequestContext({
    database,
    request: new Request('https://klopt.test/api/v1/explain', {
      headers: new Headers({
        authorization: `Bearer ${token}`,
        'idempotency-key': uuidv7(),
      }),
    }),
  })

const explain = async (query: Record<string, unknown>) =>
  (await handleExplainNumber(await context(), explainQuery.parse(query))).body

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
  const entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)
  token = (
    await issueToken(database, {
      entityId,
      name: 'explain-test',
      permissions: ['*'],
      actorKind: 'human',
      actorId: 'explain-test',
    })
  ).token

  await handleCreateContact(
    await context(),
    createContactBody.parse({ number: 'DEB-0001', name: 'Klant B.V.' }),
  )
  await handleCreateContact(
    await context(),
    createContactBody.parse({
      number: 'CRE-0001',
      name: 'Leverancier B.V.',
      isCustomer: false,
      isSupplier: true,
      vatNumber: 'NL987654321B01',
    }),
  )

  // Two issued invoices in Q1, so the revenue account and rubriek 1a both have
  // more than one line behind them.
  for (const [issueDate, unitPrice] of [
    ['2026-01-20', '10000'],
    ['2026-02-17', '25000'],
  ] as const) {
    const drafted = await handleDraftInvoice(
      await context(),
      draftInvoiceBody.parse({
        contactNumber: 'DEB-0001',
        issueDate,
        lines: [
          {
            description: 'Advies',
            quantity: '4',
            unitPrice,
            revenueAccountNumber: '8000',
            taxCode: 'H21',
          },
        ],
      }),
    )
    await handleIssueInvoice(
      await context(),
      (drafted.body as { id: string }).id,
      issueInvoiceBody.parse({}),
    )
  }

  const captured = await handleCapturePurchaseInvoice(
    await context(),
    capturePurchaseInvoiceBody.parse({
      contactNumber: 'CRE-0001',
      supplierInvoiceNumber: 'F-2026-0042',
      invoiceDate: '2026-01-05',
      dueDate: '2026-02-04',
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

  // Booked, not only captured: an unbooked invoice is not a liability, so it
  // is in neither the ageing nor the aangifte, and there would be nothing to
  // explain.
  await handleBookPurchaseInvoice(
    await context(),
    captured.body.id,
    bookPurchaseInvoiceBody.parse({}),
  )
}, 120_000)

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('explaining an account line', () => {
  const range = { fiscalYear: '2026', fromPeriod: 1, toPeriod: 13, currency: 'EUR' }

  it('adds up to the figure the profit-and-loss publishes', async () => {
    const statement = await handleGetProfitAndLoss(await context(), statementQuery.parse(range))
    const line = statement.body.revenue.lines.find((row) => row.accountNumber === '8000')

    const body = await explain({ figure: 'account', accountNumber: '8000', ...range })

    // The statement presents revenue positive; here a debit is positive, so a
    // credit balance is negative. The magnitudes have to agree.
    expect(body.amountMinorUnits).toBe(`-${line!.amount}`)
    expect(body.ties).toBe(true)
    expect(body.unexplainedMinorUnits).toBe('0')
    expect(body.lineCount).toBe(2)
  })

  it('carries the opening balance on a balance-sheet account, and still ties', async () => {
    const trial = await handleGetTrialBalance(await context(), trialBalanceQuery.parse(range))
    const row = trial.body.lines.find((candidate) => candidate.accountNumber === '1300')

    const body = await explain({ figure: 'account', accountNumber: '1300', ...range })

    expect(body.amountMinorUnits).toBe(row!.closingBalance)
    expect(body.openingMinorUnits).toBe('0')
    expect(body.ties).toBe(true)
  })

  it('counts what was carried in, not only what the lines in the range show', async () => {
    /**
     * Asked from February, the debtors balance includes January's invoice and
     * the lines in the range do not. An explanation that summed only the lines
     * would be short by exactly the opening balance and would say it ties.
     */
    const fromFebruary = await explain({
      figure: 'account',
      accountNumber: '1300',
      fiscalYear: '2026',
      fromPeriod: 2,
      toPeriod: 13,
    })
    const wholeYear = await explain({ figure: 'account', accountNumber: '1300', ...range })

    expect(fromFebruary.openingMinorUnits).toBe('48400')
    expect(fromFebruary.lineCount).toBe(1)
    expect(fromFebruary.amountMinorUnits).toBe(wholeYear.amountMinorUnits)
    expect(fromFebruary.ties).toBe(true)
  })

  it('gives every line the entry it came from', async () => {
    const body = await explain({ figure: 'account', accountNumber: '8000', ...range })

    for (const line of body.lines) {
      expect(line.entryId).toEqual(expect.any(String))
      expect(line.path).toBe(`/journal-entries/${line.entryId!}`)
      expect(line.ref).toMatch(/^VRK \d+$/)
    }
  })

  it('narrows to a period range', async () => {
    const january = await explain({
      figure: 'account',
      accountNumber: '8000',
      fiscalYear: '2026',
      fromPeriod: 1,
      toPeriod: 1,
    })

    expect(january.lineCount).toBe(1)
    expect(january.amountMinorUnits).toBe('-40000')
    expect(january.ties).toBe(true)
  })

  it('still ties when the list of lines is cut short', async () => {
    // Token discipline cuts the list; it must not cut the arithmetic. A total
    // that counted only the visible rows would report `ties: false` on
    // precisely the large figures somebody most wants to check.
    const body = await explain({
      figure: 'account',
      accountNumber: '8000',
      ...range,
      limit: 1,
    })

    expect(body.lines).toHaveLength(1)
    expect(body.lineCount).toBe(2)
    expect(body.truncated).toBe(true)
    expect(body.ties).toBe(true)
  })

  it('refuses an account this chart does not have', async () => {
    await expect(
      explain({ figure: 'account', accountNumber: '7777', fiscalYear: '2026' }),
    ).rejects.toThrow(/no account 7777/i)
  })
})

describe('explaining a BTW rubriek', () => {
  it('adds up to what the aangifte declares in that box', async () => {
    const aangifte = await handleGetVatReturn(await context(), '2026-Q1')
    const declared = aangifte.body.rubrieken.find((row) => row.id === '1a')

    const body = await explain({ figure: 'vat-rubriek', rubriek: '1a', period: '2026-Q1' })

    expect(body.amountMinorUnits).toBe(declared!.vat)
    expect(body.basis).toBe('journal-lines')
    expect(body.ties).toBe(true)
    expect(body.lineCount).toBeGreaterThan(0)
  })

  it('explains the base separately from the VAT', async () => {
    const aangifte = await handleGetVatReturn(await context(), '2026-Q1')
    const declared = aangifte.body.rubrieken.find((row) => row.id === '1a')

    const base = await explain({
      figure: 'vat-rubriek',
      rubriek: '1a',
      period: '2026-Q1',
      component: 'base',
    })

    // A box carries two figures and they have different lines behind them.
    // Summing all of a rubriek's lines would give their total, which is not a
    // number that appears anywhere on the aangifte.
    expect(base.amountMinorUnits).toBe(declared!.base)
    expect(base.ties).toBe(true)
  })

  it('states a computed box as the boxes it sums, each drillable', async () => {
    const aangifte = await handleGetVatReturn(await context(), '2026-Q1')

    const body = await explain({ figure: 'vat-rubriek', rubriek: '5c', period: '2026-Q1' })

    expect(body.amountMinorUnits).toBe(aangifte.body.payable)
    expect(body.basis).toBe('rubrieken')
    expect(body.ties).toBe(true)
    // 5c is 5a less 5b, and the minus sign has to survive.
    expect(body.lines.map((line) => line.ref)).toEqual(['5a', '5b'])
    expect(body.lines[1]?.amountMinorUnits).toBe(`-${aangifte.body.deductible}`)
    expect(body.lines[0]?.path).toContain('figure=vat-rubriek&rubriek=5a')
  })

  it('refuses a box that is not on the form', async () => {
    await expect(
      explain({ figure: 'vat-rubriek', rubriek: '9z', period: '2026-Q1' }),
    ).rejects.toThrow(/no rubriek 9z/i)
  })
})

describe('explaining an aged total', () => {
  it('adds up to what the creditor ageing report says is outstanding', async () => {
    const asOf = '2026-03-31'
    const report = await handleGetCreditorAgeing(
      await context(),
      creditorAgeingQuery.parse({ asOf }),
    )

    const body = await explain({
      figure: 'ageing-bucket',
      side: 'creditor',
      bucket: 'total',
      asOf,
    })

    expect(body.amountMinorUnits).toBe(report.body.total)
    expect(body.basis).toBe('open-items')
    expect(body.ties).toBe(true)
    expect(body.lines[0]?.ref).toBe('F-2026-0042')
    expect(body.lines[0]?.path).toMatch(/^\/purchase-invoices\//)
  })

  it('puts an invoice in the bucket its due date earns', async () => {
    // Due 2026-02-04. Fifty-five days later it is in 31–60, not in 1–30.
    const upTo60 = await explain({
      figure: 'ageing-bucket',
      side: 'creditor',
      bucket: 'upTo60',
      asOf: '2026-03-31',
    })
    const upTo30 = await explain({
      figure: 'ageing-bucket',
      side: 'creditor',
      bucket: 'upTo30',
      asOf: '2026-03-31',
    })

    expect(upTo60.lineCount).toBe(1)
    expect(upTo30.lineCount).toBe(0)
    expect(upTo30.amountMinorUnits).toBe('0')
  })

  it('counts an invoice that is not yet due on the debtor side', async () => {
    /**
     * The bug this prevents: the debtors query filtered `dueDate <= asOf` in
     * SQL, so the first of the five buckets would have been permanently empty
     * and the total short by exactly it.
     */
    const early = await explain({
      figure: 'ageing-bucket',
      side: 'debtor',
      bucket: 'current',
      asOf: '2026-01-21',
    })

    // Both invoices are issued and neither is due yet on 21 January.
    expect(early.lineCount).toBe(2)
    expect(early.amountMinorUnits).toBe('169400')
    expect(early.ties).toBe(true)
  })
})

describe('what the query has to say', () => {
  it('names the fields a figure needs rather than the ones it does not', () => {
    const missing = explainQuery.safeParse({ figure: 'vat-rubriek' })
    expect(missing.success).toBe(false)
    // The sentence, not "Invalid input": these reach a caller as a 422 body,
    // and a field they had no reason to send is not a useful thing to name on
    // its own. Found by walking the route over HTTP — the message the schema
    // carried was being dropped on the way out.
    expect(missing.error?.issues.map((issue) => issue.message)).toEqual([
      'figure=vat-rubriek needs a rubriek, e.g. 1a.',
      'figure=vat-rubriek needs a period, e.g. 2026-Q1.',
    ])

    expect(explainQuery.safeParse({ figure: 'account', accountNumber: '8000' }).success).toBe(false)
    expect(explainQuery.safeParse({ figure: 'ageing-bucket', side: 'creditor' }).success).toBe(
      false,
    )
  })

  it('refuses a range that ends before it begins', () => {
    const result = explainQuery.safeParse({
      figure: 'account',
      accountNumber: '8000',
      fiscalYear: '2026',
      fromPeriod: 6,
      toPeriod: 2,
    })
    expect(result.success).toBe(false)
  })
})
