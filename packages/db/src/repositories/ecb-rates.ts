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

export class EcbRateRepository {
  constructor(private readonly tx: Transaction) {}

  async upsertMany(
    rows: readonly {
      readonly currency: string
      readonly rateDate: string
      readonly rate: string
    }[],
  ): Promise<number> {
    if (rows.length === 0) return 0
    await this.tx
      .insert(ecbReferenceRates)
      .values(
        rows.map((row) => ({
          currency: row.currency.toUpperCase(),
          rateDate: row.rateDate,
          rate: row.rate,
          fetchedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [ecbReferenceRates.currency, ecbReferenceRates.rateDate],
        set: {
          rate: sql`excluded.rate`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      })
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
