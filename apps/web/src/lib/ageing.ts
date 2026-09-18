/**
 * Aged debtors, from the open items the dunning queue already reads.
 *
 * Crediteuren have had an ageing since M4, computed in the purchase repository
 * and reconciled against the control account. Debiteuren had nothing: what is
 * owed to this company lived only in Aanmaningen, which is a list of who to
 * write to rather than a report an accountant can read.
 *
 * Rather than model receivables a second time, this buckets what
 * `GET /api/v1/reports/overdue-invoices` already publishes — the same open
 * items, already netted against what the bank has allocated to them. Which
 * means the report can only speak about invoices that are *due*: an invoice
 * on thirty-day terms sent last week is not in it, and the screen says so
 * rather than showing an empty "niet vervallen" column and implying nobody
 * owes anything yet.
 *
 * Bucketed by how late an invoice is, not by how old it is, which is the same
 * rule the creditor side uses.
 */

export const DEBTOR_AGEING_BUCKETS = ['upTo30', 'upTo60', 'upTo90', 'over90'] as const

export type DebtorAgeingBucket = (typeof DEBTOR_AGEING_BUCKETS)[number]

export interface OverdueInvoice {
  readonly id: string
  readonly number: string | null
  readonly dueDate: string
  /** Minor units still outstanding. */
  readonly total: string
  readonly contactName: string
  readonly daysOverdue: number
}

export interface DebtorAgeingRow extends Record<DebtorAgeingBucket, string> {
  readonly contactName: string
  readonly total: string
  readonly oldestDays: number
}

export interface DebtorAgeing {
  readonly rows: readonly DebtorAgeingRow[]
  readonly totals: Record<DebtorAgeingBucket | 'total', string>
}

export function bucketFor(daysOverdue: number): DebtorAgeingBucket {
  if (daysOverdue <= 30) return 'upTo30'
  if (daysOverdue <= 60) return 'upTo60'
  if (daysOverdue <= 90) return 'upTo90'
  return 'over90'
}

export function debtorAgeing(invoices: readonly OverdueInvoice[]): DebtorAgeing {
  interface Seat extends Record<DebtorAgeingBucket, bigint> {
    contactName: string
    total: bigint
    oldestDays: number
  }

  const seats = new Map<string, Seat>()

  for (const invoice of invoices) {
    const seat: Seat = seats.get(invoice.contactName) ?? {
      contactName: invoice.contactName,
      upTo30: 0n,
      upTo60: 0n,
      upTo90: 0n,
      over90: 0n,
      total: 0n,
      oldestDays: 0,
    }

    const amount = BigInt(invoice.total)
    seat[bucketFor(invoice.daysOverdue)] += amount
    seat.total += amount
    seat.oldestDays = Math.max(seat.oldestDays, invoice.daysOverdue)
    seats.set(invoice.contactName, seat)
  }

  // Worst first: the reason to open this screen is to find out who to chase,
  // and an alphabetical list makes that a search rather than a glance.
  const ordered = [...seats.values()].sort(
    (left, right) =>
      right.oldestDays - left.oldestDays || left.contactName.localeCompare(right.contactName),
  )

  const column = (bucket: DebtorAgeingBucket): string =>
    ordered.reduce((sum, seat) => sum + seat[bucket], 0n).toString()

  return {
    rows: ordered.map((seat) => ({
      contactName: seat.contactName,
      upTo30: seat.upTo30.toString(),
      upTo60: seat.upTo60.toString(),
      upTo90: seat.upTo90.toString(),
      over90: seat.over90.toString(),
      total: seat.total.toString(),
      oldestDays: seat.oldestDays,
    })),
    totals: {
      upTo30: column('upTo30'),
      upTo60: column('upTo60'),
      upTo90: column('upTo90'),
      over90: column('over90'),
      total: ordered.reduce((sum, seat) => sum + seat.total, 0n).toString(),
    },
  }
}
