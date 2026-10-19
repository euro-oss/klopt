/**
 * What is waiting, in the order the day is worked.
 *
 * The dashboard used to be three health figures — does the trial balance net
 * to zero, does the chain verify, how much of the chart is mapped to RGS. All
 * three are worth knowing and none of them is work. A bookkeeper opening the
 * application was told the books were sound and not what to do next, while the
 * five things actually waiting for them lived on five other screens.
 *
 * The order here is the daily spine: blocking import first (nothing else moves
 * until it does), then invoice, then the bank, then what suppliers sent, then
 * the btw-aangifte. It is deliberately fixed rather than sorted by count — a
 * queue that reorders itself as the numbers move is a queue nobody can learn.
 *
 * A row with nothing in it is not shown. "Nul openstaande banktransacties" is
 * a status wall, and the whole point of this list is that everything on it is
 * something to do.
 */

export const WORK_QUEUE_ORDER = [
  'import.blocking',
  'sales.draft',
  'sales.overdue',
  'dunning.waiting',
  'bank.unmatched',
  'inbox.waiting',
  'purchase.book',
  'purchase.approve',
  'vat.filing',
] as const

export type WorkQueueKind = (typeof WORK_QUEUE_ORDER)[number]

/**
 * What a reader must be allowed to do for a row to be work *they* can do.
 *
 * The same rule the sidebar follows: the permission listed is the one the
 * operation behind the row requires, so an auditor — read and export, nothing
 * else — is not told to approve four purchase invoices they cannot approve.
 * Being late is the exception: seeing what is overdue is reading, and the
 * chasing has a row of its own. Import findings and VAT are readable when the
 * reader can open those screens.
 */
export const WORK_QUEUE_PERMISSION: Readonly<Record<WorkQueueKind, string>> = {
  'import.blocking': 'ledger:read',
  'sales.draft': 'ledger:post',
  'sales.overdue': 'ledger:read',
  'dunning.waiting': 'ledger:post',
  'bank.unmatched': 'ledger:post',
  'inbox.waiting': 'ledger:draft',
  'purchase.book': 'ledger:post',
  'purchase.approve': 'purchase:approve',
  'vat.filing': 'ledger:read',
}

/**
 * Optional detail for richer titel/ondertitel on the redesigned werklijst.
 * All fields are display-ready strings or counts already filtered to the year.
 */
export interface WorkQueueDetail {
  /** Moneybird / Exact blocking findings count already in `count`. */
  readonly source?: 'moneybird' | 'exact'
  readonly contactName?: string
  readonly invoiceNumber?: string
  readonly daysOverdue?: number
  readonly vatPeriod?: string
  readonly vatDeadline?: string
  readonly vatPayable?: string
}

export interface WorkQueueItem {
  readonly kind: WorkQueueKind
  readonly count: number
  /** Minor units, where a figure says more than a count. Otherwise null. */
  readonly amount: string | null
  readonly detail?: WorkQueueDetail | undefined
}

export interface WorkQueueCounts {
  readonly importBlocking: number
  readonly importSource: 'moneybird' | 'exact' | null
  readonly salesDrafts: number
  readonly salesOverdue: number
  /** Minor units still owed on the overdue invoices. */
  readonly salesOverdueTotal: string
  /** Richest overdue row for the werklijst subtitle, when any. */
  readonly salesOverdueTop: {
    readonly contactName: string
    readonly number: string | null
    readonly daysOverdue: number
    readonly total: string
  } | null
  readonly dunningWaiting: number
  readonly bankUnmatched: number
  readonly inboxWaiting: number
  readonly purchaseToBook: number
  readonly purchaseToApprove: number
  readonly vatFiling: number
  readonly vatPeriod: string | null
  readonly vatDeadline: string | null
  readonly vatPayable: string | null
}

/**
 * @param granted answers "may this reader do that", which is how a row that
 * would only lead to a 403 is left out. Defaults to yes, so a caller that has
 * no permissions to check — a test, a screen — gets the whole queue.
 */
export function buildWorkQueue(
  counts: WorkQueueCounts,
  granted: (permission: string) => boolean = () => true,
): readonly WorkQueueItem[] {
  const overdueDetail = ((): WorkQueueDetail | undefined => {
    if (counts.salesOverdueTop === null) return undefined
    const top = counts.salesOverdueTop
    return {
      contactName: top.contactName,
      daysOverdue: top.daysOverdue,
      ...(top.number === null ? {} : { invoiceNumber: top.number }),
    }
  })()

  const vatDetail = ((): WorkQueueDetail | undefined => {
    if (counts.vatPeriod === null) return undefined
    return {
      vatPeriod: counts.vatPeriod,
      ...(counts.vatDeadline === null ? {} : { vatDeadline: counts.vatDeadline }),
      ...(counts.vatPayable === null ? {} : { vatPayable: counts.vatPayable }),
    }
  })()

  const rows: readonly WorkQueueItem[] = [
    {
      kind: 'import.blocking',
      count: counts.importBlocking,
      amount: null,
      ...(counts.importSource === null ? {} : { detail: { source: counts.importSource } }),
    },
    { kind: 'sales.draft', count: counts.salesDrafts, amount: null },
    {
      kind: 'sales.overdue',
      count: counts.salesOverdue,
      amount: counts.salesOverdueTotal,
      ...(overdueDetail === undefined ? {} : { detail: overdueDetail }),
    },
    { kind: 'dunning.waiting', count: counts.dunningWaiting, amount: null },
    { kind: 'bank.unmatched', count: counts.bankUnmatched, amount: null },
    { kind: 'inbox.waiting', count: counts.inboxWaiting, amount: null },
    { kind: 'purchase.book', count: counts.purchaseToBook, amount: null },
    { kind: 'purchase.approve', count: counts.purchaseToApprove, amount: null },
    {
      kind: 'vat.filing',
      count: counts.vatFiling,
      amount: counts.vatPayable,
      ...(vatDetail === undefined ? {} : { detail: vatDetail }),
    },
  ]

  return rows.filter((row) => row.count > 0 && granted(WORK_QUEUE_PERMISSION[row.kind]))
}
