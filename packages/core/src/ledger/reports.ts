import type { CurrencyCode } from '../money.js'
import type { AccountType, NormalBalance } from './types.js'

/**
 * Report assembly. Pure: the repository hands over per-account totals from the
 * maintained period balances, and everything below is arithmetic on them.
 *
 * Keeping it pure is what makes "every report is derivable from the journal
 * alone" (principle 1) testable — the same function assembles a trial balance
 * from materialised balances and from a raw journal aggregation, and a
 * reconciliation test asserts the two agree.
 */

/** One account's movement in a period range, as the repository returns it. */
export interface BalanceRow {
  readonly accountId: string
  readonly accountNumber: string
  readonly accountName: string
  readonly accountType: AccountType
  readonly normalBalance: NormalBalance
  readonly rgsCode: string | null
  readonly openingDebit: bigint
  readonly openingCredit: bigint
  readonly periodDebit: bigint
  readonly periodCredit: bigint
}

export interface TrialBalanceLine {
  readonly accountId: string
  readonly accountNumber: string
  readonly accountName: string
  readonly accountType: AccountType
  readonly rgsCode: string | null
  readonly openingBalance: bigint
  readonly debit: bigint
  readonly credit: bigint
  /** Signed, debit-positive. Presentation flips it for credit-nature accounts. */
  readonly closingBalance: bigint
}

export interface TrialBalanceReport {
  readonly entityId: string
  readonly currency: CurrencyCode
  readonly fiscalYearCode: string
  readonly fromPeriod: number
  readonly toPeriod: number
  readonly lines: readonly TrialBalanceLine[]
  readonly totalDebit: bigint
  readonly totalCredit: bigint
  /**
   * Debits minus credits. Zero, always. It is reported rather than asserted
   * because a non-zero here means the ledger is corrupt, and a report that
   * throws is a report an accountant cannot use to find out why.
   */
  readonly difference: bigint
}

export interface TrialBalanceRequest {
  readonly entityId: string
  readonly currency: CurrencyCode
  readonly fiscalYearCode: string
  readonly fromPeriod: number
  readonly toPeriod: number
  /** Accounts with no movement and no opening balance are noise. */
  readonly includeZeroRows: boolean
}

export function buildTrialBalance(
  request: TrialBalanceRequest,
  rows: readonly BalanceRow[],
): TrialBalanceReport {
  const lines: TrialBalanceLine[] = []
  let totalDebit = 0n
  let totalCredit = 0n

  for (const row of rows) {
    const openingBalance = row.openingDebit - row.openingCredit
    const closingBalance = openingBalance + row.periodDebit - row.periodCredit

    if (
      !request.includeZeroRows &&
      openingBalance === 0n &&
      row.periodDebit === 0n &&
      row.periodCredit === 0n
    ) {
      continue
    }

    totalDebit += row.periodDebit
    totalCredit += row.periodCredit

    lines.push({
      accountId: row.accountId,
      accountNumber: row.accountNumber,
      accountName: row.accountName,
      accountType: row.accountType,
      rgsCode: row.rgsCode,
      openingBalance,
      debit: row.periodDebit,
      credit: row.periodCredit,
      closingBalance,
    })
  }

  lines.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, 'en', { numeric: true }))

  return {
    entityId: request.entityId,
    currency: request.currency,
    fiscalYearCode: request.fiscalYearCode,
    fromPeriod: request.fromPeriod,
    toPeriod: request.toPeriod,
    lines,
    totalDebit,
    totalCredit,
    difference: totalDebit - totalCredit,
  }
}
