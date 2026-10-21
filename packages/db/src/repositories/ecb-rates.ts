import { and, desc, eq, lte, sql } from 'drizzle-orm'
import type { EcbRateRow } from '@klopt/core'
import type { Transaction } from '../client.js'
import { ecbReferenceRates } from '../schema/documents.js'

/**
 * Cached ECB daily reference rates (issue #42).
 *
 * Inserts are idempotent on (currency, rate_date). Lookups never hit the
 * network — the adapter is responsible for fetching and calling `upsertMany`.
 */

/** Rows per INSERT … ON CONFLICT. 4 binds/row → 4_000 params, under PG's 65_535. */
export const ECB_RATE_UPSERT_BATCH_SIZE = 1_000

/** Bind parameters per upserted row (currency, rate_date, rate, fetched_at). */
export const ECB_RATE_UPSERT_PARAMS_PER_ROW = 4

/**
 * How many INSERT statements `upsertMany` will issue for `rowCount` rows.
 * Pure helper for tests that assert batching without counting SQL round-trips.
 */
export function ecbRateUpsertBatchCount(rowCount: number): number {
  if (rowCount <= 0) return 0
  return Math.ceil(rowCount / ECB_RATE_UPSERT_BATCH_SIZE)
}

export class EcbRateRepository {
  constructor(private readonly tx: Transaction) {}

  /**
   * Upsert rates in batches of {@link ECB_RATE_UPSERT_BATCH_SIZE}.
   *
   * Batches run inside the caller's transaction (`withEcbRates`): one commit for
   * the whole refresh so a mid-flight failure cannot leave a partial window
   * that looks like a successful cache warm. Per-batch commits would be safer
   * against statement timeouts on huge backfills, but web refresh only stores a
   * single-currency lookback window (hundreds of rows), so atomicity wins.
   */
  async upsertMany(
    rows: readonly {
      readonly currency: string
      readonly rateDate: string
      readonly rate: string
    }[],
  ): Promise<number> {
    if (rows.length === 0) return 0
    const fetchedAt = new Date()
    for (let offset = 0; offset < rows.length; offset += ECB_RATE_UPSERT_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + ECB_RATE_UPSERT_BATCH_SIZE)
      await this.tx
        .insert(ecbReferenceRates)
        .values(
          batch.map((row) => ({
            currency: row.currency.toUpperCase(),
            rateDate: row.rateDate,
            rate: row.rate,
            fetchedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [ecbReferenceRates.currency, ecbReferenceRates.rateDate],
          set: {
            rate: sql`excluded.rate`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        })
    }
    return rows.length
  }

  async listForCurrency(currency: string): Promise<readonly EcbRateRow[]> {
    const rows = await this.tx
      .select({
        currency: ecbReferenceRates.currency,
        rateDate: ecbReferenceRates.rateDate,
        rate: ecbReferenceRates.rate,
      })
      .from(ecbReferenceRates)
      .where(eq(ecbReferenceRates.currency, currency.toUpperCase()))
      .orderBy(desc(ecbReferenceRates.rateDate))
    return rows.map((row) => ({
      currency: row.currency,
      rateDate: row.rateDate,
      rate: String(row.rate),
    }))
  }

  async findOnOrBefore(currency: string, documentDate: string): Promise<EcbRateRow | null> {
    const [row] = await this.tx
      .select({
        currency: ecbReferenceRates.currency,
        rateDate: ecbReferenceRates.rateDate,
        rate: ecbReferenceRates.rate,
      })
      .from(ecbReferenceRates)
      .where(
        and(
          eq(ecbReferenceRates.currency, currency.toUpperCase()),
          lte(ecbReferenceRates.rateDate, documentDate),
        ),
      )
      .orderBy(desc(ecbReferenceRates.rateDate))
      .limit(1)
    if (row === undefined) return null
    return {
      currency: row.currency,
      rateDate: row.rateDate,
      rate: String(row.rate),
    }
  }
}
