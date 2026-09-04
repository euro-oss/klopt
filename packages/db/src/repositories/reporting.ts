import type { BalanceRow } from '@klopt/core'
import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import {
  accountPeriodBalances,
  accounts,
  fiscalYears,
  journalEntries,
  journalLines,
  periods,
} from '../schema/index.js'

/**
 * Reporting queries.
 *
 * Everything reads the maintained `account_period_balances` rather than
 * aggregating the journal, which is what keeps a balance sheet sub-second at
 * five million lines (spec 12). `aggregateFromJournal` exists as the
 * independent second opinion: the reconciliation check compares the two and
 * alerts on drift, and the tests assert they agree.
 */

export interface TrialBalanceQuery {
  readonly entityId: string
  readonly fiscalYearCode: string
  readonly fromPeriod: number
  readonly toPeriod: number
  readonly currency: string
}

export class ReportingRepository {
  constructor(private readonly tx: Transaction) {}

  async trialBalanceRows(query: TrialBalanceQuery): Promise<BalanceRow[]> {
    const [fiscalYear] = await this.tx
      .select({ id: fiscalYears.id })
      .from(fiscalYears)
      .where(
        and(eq(fiscalYears.entityId, query.entityId), eq(fiscalYears.code, query.fiscalYearCode)),
      )
      .limit(1)

    if (fiscalYear === undefined) return []

    const range = await this.tx
      .select({ id: periods.id, sequence: periods.sequence, startsOn: periods.startsOn })
      .from(periods)
      .where(
        and(
          eq(periods.fiscalYearId, fiscalYear.id),
          gte(periods.sequence, query.fromPeriod),
          lte(periods.sequence, query.toPeriod),
        ),
      )
      .orderBy(asc(periods.sequence))

    if (range.length === 0) return []

    // Opening balance is everything that closed before this range began,
    // including prior fiscal years. Once year close exists it will also be
    // reachable through the opening-balance entry, and the two must agree.
    const rangeStart = range[0]!.startsOn
    const openingPeriods = await this.tx
      .select({ id: periods.id })
      .from(periods)
      .where(and(eq(periods.entityId, query.entityId), lt(periods.endsOn, rangeStart)))

    const chart = await this.tx
      .select({
        id: accounts.id,
        number: accounts.number,
        name: accounts.name,
        type: accounts.type,
        normalBalance: accounts.normalBalance,
        rgsCode: accounts.rgsCode,
      })
      .from(accounts)
      .where(eq(accounts.entityId, query.entityId))
      .orderBy(asc(accounts.number))

    const sumFor = async (periodIds: readonly string[]) => {
      if (periodIds.length === 0) return new Map<string, { debit: bigint; credit: bigint }>()

      const rows = await this.tx
        .select({
          accountId: accountPeriodBalances.accountId,
          debit: sql<bigint>`sum(${accountPeriodBalances.debitMinorUnits})`,
          credit: sql<bigint>`sum(${accountPeriodBalances.creditMinorUnits})`,
        })
        .from(accountPeriodBalances)
        .where(
          and(
            eq(accountPeriodBalances.entityId, query.entityId),
            eq(accountPeriodBalances.currency, query.currency),
            inArray(accountPeriodBalances.periodId, [...periodIds]),
          ),
        )
        .groupBy(accountPeriodBalances.accountId)

      return new Map(
        rows.map((row) => [
          row.accountId,
          { debit: BigInt(row.debit), credit: BigInt(row.credit) },
        ]),
      )
    }

    const opening = await sumFor(openingPeriods.map((period) => period.id))
    const movement = await sumFor(range.map((period) => period.id))

    return chart.map((account) => ({
      accountId: account.id,
      accountNumber: account.number,
      accountName: account.name,
      accountType: account.type,
      normalBalance: account.normalBalance,
      rgsCode: account.rgsCode,
      openingDebit: opening.get(account.id)?.debit ?? 0n,
      openingCredit: opening.get(account.id)?.credit ?? 0n,
      periodDebit: movement.get(account.id)?.debit ?? 0n,
      periodCredit: movement.get(account.id)?.credit ?? 0n,
    }))
  }

  /**
   * The same totals, aggregated straight from the journal lines.
   *
   * Deliberately not used by the reports. It is the independent check that the
   * maintained balances have not drifted — principle 1 says every report is
   * derivable from the journal alone, and this is what makes that claim
   * testable rather than aspirational.
   */
  async aggregateFromJournal(
    entityId: string,
    currency: string,
  ): Promise<Map<string, { debit: bigint; credit: bigint }>> {
    const rows = await this.tx
      .select({
        accountId: journalLines.accountId,
        debit: sql<bigint>`sum(${journalLines.debitMinorUnits})`,
        credit: sql<bigint>`sum(${journalLines.creditMinorUnits})`,
      })
      .from(journalLines)
      .where(and(eq(journalLines.entityId, entityId), eq(journalLines.currency, currency)))
      .groupBy(journalLines.accountId)

    return new Map(
      rows.map((row) => [row.accountId, { debit: BigInt(row.debit), credit: BigInt(row.credit) }]),
    )
  }

  async listAccounts(entityId: string) {
    return this.tx
      .select({
        id: accounts.id,
        number: accounts.number,
        name: accounts.name,
        type: accounts.type,
        normalBalance: accounts.normalBalance,
        rgsCode: accounts.rgsCode,
        isBlocked: accounts.isBlocked,
        defaultTaxCode: accounts.defaultTaxCode,
      })
      .from(accounts)
      .where(eq(accounts.entityId, entityId))
      .orderBy(asc(accounts.number))
  }

  /** Cursor-paginated by chain sequence, which is dense and monotonic per entity. */
  async listEntries(request: {
    readonly entityId: string
    readonly afterSequence: bigint | null
    readonly limit: number
  }) {
    const conditions = [eq(journalEntries.entityId, request.entityId)]
    if (request.afterSequence !== null) {
      conditions.push(sql`${journalEntries.chainSequence} > ${request.afterSequence}`)
    }

    return this.tx
      .select({
        id: journalEntries.id,
        chainSequence: journalEntries.chainSequence,
        entryNumber: journalEntries.entryNumber,
        bookingDate: journalEntries.bookingDate,
        documentDate: journalEntries.documentDate,
        description: journalEntries.description,
        hash: journalEntries.hash,
      })
      .from(journalEntries)
      .where(and(...conditions))
      .orderBy(asc(journalEntries.chainSequence))
      .limit(request.limit)
  }
}
