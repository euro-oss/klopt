import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { LedgerError } from '../../src/errors.js'
import { loadReferenceDataFromDirectory } from '../../src/reference/store.js'
import type { ReferenceDataStore } from '../../src/reference/store.js'
import { ChartError, loadChart, type Chart } from '../../src/setup/chart.js'
import { nextFiscalYearCode, planFiscalYear } from '../../src/setup/fiscal-year.js'
import { planEntitySetup } from '../../src/setup/plan.js'

/**
 * Provisioning a new administration.
 *
 * The shipped charts are validated against the **real** RGS 3.7 scheme rather
 * than a fixture, because the failure this guards against is exactly the one a
 * fixture cannot see: a plausible-looking RGS code that does not exist. Four
 * invented codes already got into the test fixtures once, and the only thing
 * that caught them was checking against all 3691.
 */

const REFERENCE_DATA = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'reference-data',
)

let store: ReferenceDataStore

beforeAll(() => {
  store = loadReferenceDataFromDirectory(REFERENCE_DATA)
})

describe('the shipped charts of accounts', () => {
  it('ships at least the Dutch MKB one', () => {
    expect(store.charts.map((chart) => chart.code)).toContain('nl-mkb')
  })

  it('maps every account onto a real, current, postable RGS code', () => {
    const problems: string[] = []

    for (const chart of store.charts) {
      const scheme = store.rgs(`${chart.rgsVersion}-${chart.rgsVariant}`)

      for (const account of chart.accounts) {
        if (account.rgsCode === null) continue
        const code = scheme.get(account.rgsCode)

        if (code === undefined) {
          problems.push(`${chart.code} ${account.number}: ${account.rgsCode} is not an RGS code`)
          continue
        }
        if (code.inactive) {
          problems.push(`${chart.code} ${account.number}: ${account.rgsCode} is inactive`)
        }
        // Level 4 is the posting level; mapping to a heading rolls a whole
        // branch onto one account and makes the export wrong rather than empty.
        if (code.level < 4) {
          problems.push(
            `${chart.code} ${account.number}: ${account.rgsCode} is level ${String(code.level)}`,
          )
        }
        // RGS says D or C; the ledger says debit or credit.
        const side =
          code.debitCredit === null ? null : code.debitCredit === 'D' ? 'debit' : 'credit'
        if (side !== null && side !== account.normalBalance) {
          problems.push(
            `${chart.code} ${account.number}: RGS says ${code.debitCredit}, chart says ${account.normalBalance}`,
          )
        }
      }
    }

    expect(problems).toEqual([])
  })

  it('names an account for every role', () => {
    for (const chart of store.charts) {
      const numbers = new Set(chart.accounts.map((account) => account.number))
      for (const role of Object.keys(chart.roles) as (keyof typeof chart.roles)[]) {
        const number = chart.roles[role]
        expect(numbers.has(number), `${chart.code}: role ${role} -> ${number}`).toBe(true)
      }
    }
  })

  it('gives every tax code an account and a UBL category', () => {
    for (const chart of store.charts) {
      for (const code of chart.taxCodes) {
        expect(chart.roles[code.accountRole], `${chart.code} ${code.code}`).toBeTypeOf('string')
        expect(code.ublCategory).toMatch(/^[A-Z]{1,2}$/)
      }
    }
  })

  it('has somewhere to post: at least a sales, purchase and memoriaal journal', () => {
    for (const chart of store.charts) {
      const types = new Set(chart.journals.map((journal) => journal.type))
      expect(types.has('verkoop'), chart.code).toBe(true)
      expect(types.has('inkoop'), chart.code).toBe(true)
      expect(types.has('memoriaal'), chart.code).toBe(true)
    }
  })
})

describe('loading a chart', () => {
  const valid = {
    chart: 'klopt.chart-of-accounts',
    code: 'x',
    name: 'X',
    rgsVersion: '3.7',
    rgsVariant: 'mkb',
    roles: {
      receivable: '1300',
      payable: '1300',
      vatPayable: '1300',
      vatReceivable: '1300',
      result: '1300',
      bank: '1300',
      cash: '1300',
      revenue: '1300',
    },
    accounts: [
      { number: '1300', name: 'Debiteuren', type: 'asset', normalBalance: 'debit', rgsCode: null },
    ],
    journals: [{ code: 'MEM', name: 'Memoriaal', type: 'memoriaal' }],
  }

  it('accepts a minimal chart', () => {
    expect(loadChart(valid).code).toBe('x')
  })

  it('refuses a role pointing at an account the chart does not have', () => {
    const broken = { ...valid, roles: { ...valid.roles, bank: '9999' } }
    expect(() => loadChart(broken)).toThrow(ChartError)
  })

  it('refuses a chart with no journals, because there is nowhere to post', () => {
    expect(() => loadChart({ ...valid, journals: [] })).toThrow(ChartError)
  })

  it('refuses a duplicate account number', () => {
    const broken = { ...valid, accounts: [...valid.accounts, ...valid.accounts] }
    expect(() => loadChart(broken)).toThrow(/Duplicate account number/)
  })
})

describe('laying out a fiscal year', () => {
  it('runs January to December for a calendar year', () => {
    const year = planFiscalYear('2026', 1)
    expect(year.startsOn).toBe('2026-01-01')
    expect(year.endsOn).toBe('2026-12-31')
    expect(year.periods).toHaveLength(12)
  })

  it('crosses the new year when the book year starts in July (spec 6.4)', () => {
    const year = planFiscalYear('2026', 7)
    expect(year.startsOn).toBe('2026-07-01')
    expect(year.endsOn).toBe('2027-06-30')
    expect(year.periods[0]?.startsOn).toBe('2026-07-01')
    expect(year.periods[11]?.endsOn).toBe('2027-06-30')
  })

  it('leaves no gap and no overlap between periods', () => {
    for (const startMonth of [1, 4, 7, 10]) {
      const year = planFiscalYear('2024', startMonth)
      for (let index = 1; index < year.periods.length; index += 1) {
        const previousEnd = Date.parse(`${year.periods[index - 1]!.endsOn}T00:00:00Z`)
        const start = Date.parse(`${year.periods[index]!.startsOn}T00:00:00Z`)
        expect(start - previousEnd).toBe(86_400_000)
      }
    }
  })

  it('gets February right in a leap year', () => {
    expect(planFiscalYear('2024', 1).periods[1]?.endsOn).toBe('2024-02-29')
    expect(planFiscalYear('2025', 1).periods[1]?.endsOn).toBe('2025-02-28')
  })

  it('refuses a month outside 1..12 and a code that is not four digits', () => {
    expect(() => planFiscalYear('2026', 0)).toThrow(LedgerError)
    expect(() => planFiscalYear('2026', 13)).toThrow(LedgerError)
    expect(() => planFiscalYear('26', 1)).toThrow(LedgerError)
  })

  it('knows which year a close carries into', () => {
    expect(nextFiscalYearCode('2026')).toBe('2027')
    expect(nextFiscalYearCode('2099')).toBe('2100')
  })
})

describe('planning an administration', () => {
  let chart: Chart

  beforeAll(() => {
    chart = store.chart('nl-mkb')
  })

  it('needs only a name and a year', () => {
    const plan = planEntitySetup({ name: 'Mijn Bedrijf', firstFiscalYear: '2026' }, chart)

    expect(plan.entity.name).toBe('Mijn Bedrijf')
    // A sole trader has no separate statutory name, and making them type it
    // twice is not a validation.
    expect(plan.entity.legalName).toBe('Mijn Bedrijf')
    expect(plan.entity.functionalCurrency).toBe('EUR')
    expect(plan.entity.rgsVersion).toBe('3.7')
    expect(plan.fiscalYear.code).toBe('2026')
    expect(plan.accounts).toHaveLength(chart.accounts.length)
    expect(plan.journals).toHaveLength(chart.journals.length)
  })

  it('points every tax code at an account the plan creates', () => {
    const plan = planEntitySetup({ name: 'X', firstFiscalYear: '2026' }, chart)
    const numbers = new Set(plan.accounts.map((account) => account.number))

    expect(plan.taxCodes.length).toBeGreaterThan(0)
    for (const code of plan.taxCodes) {
      expect(numbers.has(code.accountNumber), code.code).toBe(true)
    }
  })

  it('opens the tax codes on the day the books do, never before', () => {
    const plan = planEntitySetup({ name: 'X', firstFiscalYear: '2026' }, chart)
    for (const code of plan.taxCodes) {
      expect(code.validFrom).toBe(plan.fiscalYear.startsOn)
    }
  })

  it('normalises a VAT number and rejects a malformed Dutch one', () => {
    const plan = planEntitySetup(
      { name: 'X', firstFiscalYear: '2026', vatNumber: ' nl123456789b01 ' },
      chart,
    )
    expect(plan.entity.vatNumber).toBe('NL123456789B01')

    expect(() =>
      planEntitySetup({ name: 'X', firstFiscalYear: '2026', vatNumber: 'NL12345B01' }, chart),
    ).toThrow(LedgerError)
  })

  it('reports every bad field at once, not one per round trip', () => {
    let violations: readonly { code: string; path: string | null }[] = []
    try {
      planEntitySetup(
        {
          name: '  ',
          firstFiscalYear: '26',
          kvkNumber: '123',
          functionalCurrency: 'euro',
        },
        chart,
      )
    } catch (error: unknown) {
      if (!(error instanceof LedgerError)) throw error
      violations = error.violations
    }

    expect(violations.map((item) => item.code).sort()).toEqual([
      'invalid_currency',
      'invalid_date',
      'invalid_kvk_number',
      'invalid_name',
    ])
  })

  it('takes the currency from the chart when the caller does not say', () => {
    const plan = planEntitySetup({ name: 'X', firstFiscalYear: '2026' }, chart)
    expect(plan.entity.functionalCurrency).toBe(chart.currency)
  })
})
