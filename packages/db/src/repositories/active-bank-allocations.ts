import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { bankTransactionAllocations, bankTransactions, journalEntries } from '../schema/index.js'

/**
 * Per-invoice sums of bank match allocations that still reduce outstanding.
 *
 * Allocations stay in the table for audit; once the bank line's match entry is
 * reversed they must not count toward what is open. Every query that subtracts
 * allocations from an invoice total should join this subquery — not
 * `bank_transaction_allocations` on its own — so match candidates, dunning,
 * overdue lists and contact guards cannot drift.
 */
export function activeBankAllocationsPerInvoice(tx: Transaction, entityId: string) {
  return tx
    .select({
      invoiceId: bankTransactionAllocations.invoiceId,
      total: sql<string>`sum(${bankTransactionAllocations.amountMinorUnits})::text`.as('allocated'),
    })
    .from(bankTransactionAllocations)
    .innerJoin(bankTransactions, eq(bankTransactions.id, bankTransactionAllocations.transactionId))
    .leftJoin(
      journalEntries,
      and(
        eq(journalEntries.entityId, entityId),
        eq(journalEntries.reversesEntryId, bankTransactions.journalEntryId),
      ),
    )
    .where(and(eq(bankTransactionAllocations.entityId, entityId), isNull(journalEntries.id)))
    .groupBy(bankTransactionAllocations.invoiceId)
    .as('allocated')
}

/** Raw sum of allocation rows — tests only, to prove the reversal filter matters. */
export function allBankAllocationsPerInvoiceForTest(tx: Transaction, entityId: string) {
  return tx
    .select({
      invoiceId: bankTransactionAllocations.invoiceId,
      total: sql<string>`sum(${bankTransactionAllocations.amountMinorUnits})::text`.as('allocated'),
    })
    .from(bankTransactionAllocations)
    .where(eq(bankTransactionAllocations.entityId, entityId))
    .groupBy(bankTransactionAllocations.invoiceId)
    .as('allocated_all')
}
