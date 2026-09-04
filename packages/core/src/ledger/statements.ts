import type { CurrencyCode } from '../money.js'
import type { RgsScheme } from '../rgs/scheme.js'
import { effectiveCode } from '../rgs/mapping.js'
import type { BalanceRow } from './reports.js'
import type { AccountType } from './types.js'

/**
 * Balance sheet and profit-and-loss (spec 5.1).
 *
 * Pure assembly over the same `BalanceRow` the trial balance uses, so all three
 * statements are provably the same numbers arranged differently — the balance
 * sheet's result for the year must equal the P&L's bottom line, and that is
 * asserted rather than assumed.
 *
 * Sign convention: every figure is **presentation-positive**. An asset with a
 * debit balance and a liability with a credit balance both come out positive,
 * which is how a Dutch balance sheet reads. `signedBalance` keeps the raw
 * debit-positive figure for anyone who needs to do arithmetic across sides.
 */

const BALANCE_SHEET_TYPES: ReadonlySet<AccountType> = new Set(['asset', 'liability', 'equity'])

export interface StatementLine {
  readonly accountNumber: string
  readonly accountName: string
  readonly accountType: AccountType
  readonly rgsCode: string | null
  /** Debit-positive. Negative means the balance is on the credit side. */
  readonly signedBalance: bigint
  /** Positive as presented, given the account's side of the statement. */
  readonly amount: bigint
}

export interface StatementSection {
  readonly key: string
  readonly title: string
  readonly lines: readonly StatementLine[]
  readonly total: bigint
}

export interface BalanceSheet {
  readonly kind: 'balance-sheet'
  readonly currency: CurrencyCode
  readonly asOf: string
  readonly assets: StatementSection
  readonly liabilities: StatementSection
  readonly equity: StatementSection
  /**
   * Profit for the period, not yet appropriated. Shown within equity on the
   * face of the sheet, exactly as it is before a year close runs.
   */
  readonly resultForPeriod: bigint
  readonly totalAssets: bigint
  readonly totalLiabilitiesAndEquity: bigint
  /** Zero, always. Reported rather than asserted, so a broken ledger is legible. */
  readonly difference: bigint
}

export interface ProfitAndLoss {
  readonly kind: 'profit-and-loss'
  readonly currency: CurrencyCode
  readonly fromDate: string
  readonly toDate: string
  readonly revenue: StatementSection
  readonly expenses: StatementSection
  /** Positive is a profit. */
  readonly result: bigint
}

export interface StatementRequest {
  readonly currency: CurrencyCode
  readonly fromDate: string
  readonly toDate: string
}

function closing(row: BalanceRow): bigint {
  return row.openingDebit - row.openingCredit + row.periodDebit - row.periodCredit
}

/** Movement only, ignoring the opening balance. What a P&L reports. */
function movement(row: BalanceRow): bigint {
  return row.periodDebit - row.periodCredit
}

function toLine(row: BalanceRow, signed: bigint, presentAsDebit: boolean): StatementLine {
  return {
    accountNumber: row.accountNumber,
    accountName: row.accountName,
    accountType: row.accountType,
    rgsCode: row.rgsCode,
    signedBalance: signed,
    amount: presentAsDebit ? signed : -signed,
  }
}

function section(key: string, title: string, lines: readonly StatementLine[]): StatementSection {
  const sorted = [...lines].sort((a, b) =>
    a.accountNumber.localeCompare(b.accountNumber, 'en', { numeric: true }),
  )
  return {
    key,
    title,
    lines: sorted,
    total: sorted.reduce((total, line) => total + line.amount, 0n),
  }
}

export function buildProfitAndLoss(
  request: StatementRequest,
  rows: readonly BalanceRow[],
): ProfitAndLoss {
  const revenue: StatementLine[] = []
  const expenses: StatementLine[] = []

  for (const row of rows) {
    if (BALANCE_SHEET_TYPES.has(row.accountType)) continue

    // A P&L reports the period's movement. Carrying an opening balance into it
    // would double-count last year's result.
    const signed = movement(row)
    if (signed === 0n) continue

    if (row.accountType === 'revenue') revenue.push(toLine(row, signed, false))
    else expenses.push(toLine(row, signed, true))
  }

  const revenueSection = section('revenue', 'Opbrengsten', revenue)
  const expenseSection = section('expenses', 'Kosten', expenses)

  return {
    kind: 'profit-and-loss',
    currency: request.currency,
    fromDate: request.fromDate,
    toDate: request.toDate,
    revenue: revenueSection,
    expenses: expenseSection,
    result: revenueSection.total - expenseSection.total,
  }
}

export function buildBalanceSheet(
  request: StatementRequest,
  rows: readonly BalanceRow[],
): BalanceSheet {
  const assets: StatementLine[] = []
  const liabilities: StatementLine[] = []
  const equity: StatementLine[] = []
  let result = 0n

  for (const row of rows) {
    if (!BALANCE_SHEET_TYPES.has(row.accountType)) {
      // A P&L account's movement is this period's result, which belongs in
      // equity on the balance sheet until a year close appropriates it.
      result -= movement(row)
      continue
    }

    const signed = closing(row)
    if (signed === 0n) continue

    if (row.accountType === 'asset') assets.push(toLine(row, signed, true))
    else if (row.accountType === 'liability') liabilities.push(toLine(row, signed, false))
    else equity.push(toLine(row, signed, false))
  }

  const assetSection = section('assets', 'Activa', assets)
  const liabilitySection = section('liabilities', 'Schulden', liabilities)
  const equitySection = section('equity', 'Eigen vermogen', equity)

  const totalLiabilitiesAndEquity = liabilitySection.total + equitySection.total + result

  return {
    kind: 'balance-sheet',
    currency: request.currency,
    asOf: request.toDate,
    assets: assetSection,
    liabilities: liabilitySection,
    equity: equitySection,
    resultForPeriod: result,
    totalAssets: assetSection.total,
    totalLiabilitiesAndEquity,
    difference: assetSection.total - totalLiabilitiesAndEquity,
  }
}

export interface RgsStatementLine {
  readonly rgsCode: string
  readonly referenceNumber: string
  readonly description: string
  readonly level: number
  readonly amount: bigint
  readonly accountNumbers: readonly string[]
}

/**
 * The same figures rolled up onto RGS codes, which is what an accountant's
 * software wants and what makes the export worth having.
 *
 * Balances are placed under their omslagcode when they have landed on the
 * other side — RGS indirect mapping — and every ancestor level is totalled, so
 * a consumer can read the report at whatever depth it needs.
 */
export function rollUpToRgs(
  rows: readonly BalanceRow[],
  scheme: RgsScheme,
  options: { readonly usePeriodMovement: boolean },
): readonly RgsStatementLine[] {
  const totals = new Map<string, { amount: bigint; accounts: Set<string> }>()

  const add = (code: string, amount: bigint, accountNumber: string): void => {
    const current = totals.get(code) ?? { amount: 0n, accounts: new Set<string>() }
    current.amount += amount
    current.accounts.add(accountNumber)
    totals.set(code, current)
  }

  for (const row of rows) {
    if (row.rgsCode === null) continue
    const base = scheme.get(row.rgsCode)
    if (base === undefined) continue

    const amount = options.usePeriodMovement ? movement(row) : closing(row)
    if (amount === 0n) continue

    const target = effectiveCode(base, amount, scheme)
    add(target.code, amount, row.accountNumber)
    for (const ancestor of scheme.ancestorsOf(target.code)) {
      add(ancestor.code, amount, row.accountNumber)
    }
  }

  const lines: RgsStatementLine[] = []
  for (const [code, total] of totals) {
    const definition = scheme.get(code)
    if (definition === undefined) continue
    lines.push({
      rgsCode: code,
      referenceNumber: definition.referenceNumber,
      description: definition.description,
      level: definition.level,
      amount: total.amount,
      accountNumbers: [...total.accounts].sort(),
    })
  }

  lines.sort(
    (a, b) =>
      a.referenceNumber.localeCompare(b.referenceNumber) || a.rgsCode.localeCompare(b.rgsCode),
  )
  return lines
}
