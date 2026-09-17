import { describe, expect, it } from 'vitest'
import { buildBalanceSheet, buildProfitAndLoss } from '../../src/ledger/statements.js'
import { buildTrialBalance, type BalanceRow } from '../../src/ledger/reports.js'
import { planYearClose } from '../../src/ledger/year-close.js'
import { LedgerError } from '../../src/errors.js'
import type { AccountType, NormalBalance } from '../../src/ledger/types.js'

/**
 * The three statements are the same numbers arranged differently, so the tests
 * that matter are the ones asserting they agree: the balance sheet's result for
 * the period must equal the P&L's bottom line, and the year close must flatten
 * the P&L without moving the balance sheet's total.
 */

function row(
  accountNumber: string,
  accountType: AccountType,
  options: {
    openingDebit?: bigint
    openingCredit?: bigint
    periodDebit?: bigint
    periodCredit?: bigint
    rgsCode?: string | null
  } = {},
): BalanceRow {
  const normalBalance: NormalBalance =
    accountType === 'asset' || accountType === 'expense' ? 'debit' : 'credit'
  return {
    accountId: accountNumber,
    accountNumber,
    accountName: `Account ${accountNumber}`,
    accountType,
    normalBalance,
    rgsCode: options.rgsCode ?? null,
    openingDebit: options.openingDebit ?? 0n,
    openingCredit: options.openingCredit ?? 0n,
    periodDebit: options.periodDebit ?? 0n,
    periodCredit: options.periodCredit ?? 0n,
  }
}

/**
 * A small but complete year: 5000 of share capital, 12100 invoiced with 2100
 * BTW, 4000 of purchases, 6000 collected.
 */
function year(): BalanceRow[] {
  return [
    row('1100', 'asset', { openingDebit: 5000_00n, periodDebit: 6000_00n }),
    row('1300', 'asset', { periodDebit: 12_100_00n, periodCredit: 6000_00n }),
    row('1500', 'liability', { periodCredit: 2100_00n }),
    row('1600', 'liability', { periodCredit: 4000_00n }),
    row('0500', 'equity', { openingCredit: 5000_00n }),
    row('8000', 'revenue', { periodCredit: 10_000_00n }),
    row('4000', 'expense', { periodDebit: 4000_00n }),
  ]
}

const request = { currency: 'EUR', fromDate: '2026-01-01', toDate: '2026-12-31' }

describe('profit and loss', () => {
  it('reports revenue and expenses positive, and the result', () => {
    const statement = buildProfitAndLoss(request, year())

    expect(statement.revenue.total).toBe(10_000_00n)
    expect(statement.expenses.total).toBe(4000_00n)
    expect(statement.result).toBe(6000_00n)
  })

  it('ignores balance-sheet accounts', () => {
    const numbers = buildProfitAndLoss(request, year()).revenue.lines.map(
      (line) => line.accountNumber,
    )
    expect(numbers).toEqual(['8000'])
  })

  it('reports the period movement, not the accumulated balance', () => {
    // A P&L account carrying an opening balance means last year was not closed.
    // Including it would report last year's result again this year.
    const rows = [row('8000', 'revenue', { openingCredit: 99_999_00n, periodCredit: 1000_00n })]
    expect(buildProfitAndLoss(request, rows).result).toBe(1000_00n)
  })
})

describe('balance sheet', () => {
  it('balances', () => {
    const sheet = buildBalanceSheet(request, year())

    expect(sheet.totalAssets).toBe(17_100_00n)
    expect(sheet.difference).toBe(0n)
    expect(sheet.totalLiabilitiesAndEquity).toBe(sheet.totalAssets)
  })

  it('shows the unappropriated result inside equity', () => {
    const sheet = buildBalanceSheet(request, year())
    const statement = buildProfitAndLoss(request, year())

    // The number the two statements share. If these ever disagree, one of them
    // is lying to an accountant.
    expect(sheet.resultForPeriod).toBe(statement.result)
  })

  it('presents each side positive', () => {
    const sheet = buildBalanceSheet(request, year())
    for (const line of [...sheet.assets.lines, ...sheet.liabilities.lines, ...sheet.equity.lines]) {
      expect(line.amount, line.accountNumber).toBeGreaterThan(0n)
    }
    // A creditor balance is a credit, so its raw signed balance is negative.
    expect(sheet.liabilities.lines[0]?.signedBalance).toBeLessThan(0n)
  })

  it('agrees with the trial balance', () => {
    const rows = year()
    const trial = buildTrialBalance(
      {
        entityId: 'e',
        currency: 'EUR',
        fiscalYearCode: '2026',
        fromPeriod: 1,
        toPeriod: 12,
        includeZeroRows: false,
      },
      rows,
    )
    const sheet = buildBalanceSheet(request, rows)

    expect(trial.difference).toBe(0n)
    expect(sheet.difference).toBe(0n)
  })
})

describe('year close', () => {
  const closeRequest = {
    entityId: 'entity-1',
    resultAccountNumber: '0500',
    journalCode: 'MEM',
    closingDate: '2026-12-31',
    openingDate: '2027-01-01',
    fiscalYearCode: '2026',
  }

  it('produces two entries: appropriation and opening balance', () => {
    const plan = planYearClose(closeRequest, year())

    expect(plan.result).toBe(6000_00n)
    expect(plan.appropriation).not.toBeNull()
    expect(plan.openingBalance).not.toBeNull()
    expect(plan.appropriation?.bookingDate).toBe('2026-12-31')
    expect(plan.openingBalance?.bookingDate).toBe('2027-01-01')
  })

  it('writes every profit-and-loss account back to zero', () => {
    const plan = planYearClose(closeRequest, year())
    const lines = plan.appropriation!.lines

    const revenue = lines.find((line) => line.accountNumber === '8000')
    const expense = lines.find((line) => line.accountNumber === '4000')
    // Revenue sits credit, so it is written back with a debit, and vice versa.
    expect(revenue?.debit).toBe(10_000_00n)
    expect(expense?.credit).toBe(4000_00n)
  })

  it('credits the result to equity, and the entry balances', () => {
    const plan = planYearClose(closeRequest, year())
    const lines = plan.appropriation!.lines

    const equity = lines.find((line) => line.accountNumber === '0500')
    expect(equity?.credit).toBe(6000_00n)

    const net = lines.reduce((total, line) => total + line.debit - line.credit, 0n)
    expect(net).toBe(0n)
  })

  it('carries balance-sheet accounts forward, including the appropriated result', () => {
    const plan = planYearClose(closeRequest, year())
    const lines = plan.openingBalance!.lines

    expect(lines.find((line) => line.accountNumber === '1100')?.debit).toBe(11_000_00n)
    // 5000 of share capital plus 6000 of result.
    expect(lines.find((line) => line.accountNumber === '0500')?.credit).toBe(11_000_00n)
    // No P&L account may appear in an opening balance.
    expect(lines.some((line) => line.accountNumber === '8000')).toBe(false)

    const net = lines.reduce((total, line) => total + line.debit - line.credit, 0n)
    expect(net).toBe(0n)
  })

  it('leaves the P&L flat and the balance sheet unmoved once applied', () => {
    const rows = year()
    const plan = planYearClose(closeRequest, rows)
    const before = buildBalanceSheet(request, rows)

    // Apply the appropriation to the balances by hand, as posting would.
    const applied = rows.map((source) => {
      const line = plan.appropriation!.lines.find(
        (candidate) => candidate.accountNumber === source.accountNumber,
      )
      if (line === undefined) return source
      return {
        ...source,
        periodDebit: source.periodDebit + line.debit,
        periodCredit: source.periodCredit + line.credit,
      }
    })

    const after = buildBalanceSheet(request, applied)
    const profitAndLoss = buildProfitAndLoss(request, applied)

    expect(profitAndLoss.result).toBe(0n)
    expect(after.resultForPeriod).toBe(0n)
    expect(after.totalAssets).toBe(before.totalAssets)
    expect(after.difference).toBe(0n)
    // The result has moved from "result for the period" into equity proper.
    expect(after.equity.total).toBe(before.equity.total + before.resultForPeriod)
  })

  it('refuses to appropriate to an account that is not equity', () => {
    expect(() => planYearClose({ ...closeRequest, resultAccountNumber: '1100' }, year())).toThrow(
      LedgerError,
    )
  })

  it('refuses an account that does not exist', () => {
    expect(() => planYearClose({ ...closeRequest, resultAccountNumber: '9999' }, year())).toThrow(
      /No account 9999/,
    )
  })

  it('has nothing to appropriate in a year with no trading', () => {
    const plan = planYearClose(closeRequest, [row('0500', 'equity', { openingCredit: 100n })])
    expect(plan.appropriation).toBeNull()
    expect(plan.result).toBe(0n)
    expect(plan.openingBalance).not.toBeNull()
  })

  it('handles a loss', () => {
    const rows = [
      row('1100', 'asset', { periodDebit: 1000_00n }),
      row('0500', 'equity', { periodCredit: 3000_00n }),
      row('4000', 'expense', { periodDebit: 2000_00n }),
    ]
    const plan = planYearClose(closeRequest, rows)

    expect(plan.result).toBe(-2000_00n)
    // A loss is a debit to equity.
    expect(plan.appropriation!.lines.find((line) => line.accountNumber === '0500')?.debit).toBe(
      2000_00n,
    )
  })
})
