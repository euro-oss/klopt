/**
 * What is waiting, in the order the day is worked.
 *
 * The dashboard used to be three health figures — does the trial balance net
 * to zero, does the chain verify, how much of the chart is mapped to RGS. All
 * three are worth knowing and none of them is work. A bookkeeper opening the
 * application was told the books were sound and not what to do next, while the
 * five things actually waiting for them lived on five other screens.
 *
 * The order here is the daily spine: invoice, then the bank, then what
 * suppliers sent. It is deliberately fixed rather than sorted by count — a
 * queue that reorders itself as the numbers move is a queue nobody can learn.
 *
 * A row with nothing in it is not shown. "Nul openstaande banktransacties" is
 * a status wall, and the whole point of this list is that everything on it is
 * something to do.
 */

export const WORK_QUEUE_ORDER = [
  'sales.draft',
  'sales.overdue',
  'bank.unmatched',
  'inbox.waiting',
  'purchase.book',
  'purchase.approve',
] as const

export type WorkQueueKind = (typeof WORK_QUEUE_ORDER)[number]

export interface WorkQueueItem {
  readonly kind: WorkQueueKind
  readonly count: number
  /** Minor units, where a figure says more than a count. Otherwise null. */
  readonly amount: string | null
}

export interface WorkQueueCounts {
  readonly salesDrafts: number
  readonly salesOverdue: number
  /** Minor units still owed on the overdue invoices. */
  readonly salesOverdueTotal: string
  readonly bankUnmatched: number
  readonly inboxWaiting: number
  readonly purchaseToBook: number
  readonly purchaseToApprove: number
}

export function buildWorkQueue(counts: WorkQueueCounts): readonly WorkQueueItem[] {
  const rows: readonly WorkQueueItem[] = [
    { kind: 'sales.draft', count: counts.salesDrafts, amount: null },
    { kind: 'sales.overdue', count: counts.salesOverdue, amount: counts.salesOverdueTotal },
    { kind: 'bank.unmatched', count: counts.bankUnmatched, amount: null },
    { kind: 'inbox.waiting', count: counts.inboxWaiting, amount: null },
    { kind: 'purchase.book', count: counts.purchaseToBook, amount: null },
    { kind: 'purchase.approve', count: counts.purchaseToApprove, amount: null },
  ]

  return rows.filter((row) => row.count > 0)
}
