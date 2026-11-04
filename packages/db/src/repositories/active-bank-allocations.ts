import { eq, sql } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { bankTransactionAllocations } from '../schema/index.js'

/**
 * Per-invoice sums of bank match allocations.
 *
 * Every query that subtracts allocations from an invoice total should use this
 * subquery so match candidates, dunning, overdue lists and contact guards
 * cannot drift.
 */
export function bankAllocationsPerInvoiceSubquery(tx: Transaction, entityId: string) {
  return tx
    .select({
      invoiceId: bankTransactionAllocations.invoiceId,
      total: sql<string>`sum(${bankTransactionAllocations.amountMinorUnits})::text`.as('allocated'),
    })
    .from(bankTransactionAllocations)
    .where(eq(bankTransactionAllocations.entityId, entityId))
    .groupBy(bankTransactionAllocations.invoiceId)
    .as('allocated')
}
