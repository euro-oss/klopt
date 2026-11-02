/**
 * Costs list segmentation and status pills (#107 Phase 4 / #128).
 *
 * Board: Costs.dc.html — segments All / To pay / Paid from `outstanding` on
 * the purchase-invoice list (unlike Sales, which still lacks that field).
 * Overdue uses an exclusive due-date boundary (`dueDate < asOf`), same as #119.
 */

/** Days between two ISO dates (`to - from`), calendar days in UTC. */
export function daysBetweenIso(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export type CostsSegment = 'all' | 'open' | 'paid'

export type CostsTab = 'bills' | 'approve'

export interface CostsInvoiceRow {
  readonly id: string
  readonly status: 'draft' | 'booked' | 'approved' | 'disputed' | 'cancelled'
  readonly kind: 'invoice' | 'credit_note'
  readonly supplierInvoiceNumber: string
  readonly contactNumber: string
  readonly contactName: string
  readonly invoiceDate: string
  readonly dueDate: string
  readonly total: string
  readonly outstanding: string
  readonly scheduled: string
  readonly payable: boolean
  readonly disputedReason: string | null
}

export interface CostsSegmentCounts {
  readonly all: number
  readonly open: number
  readonly paid: number
}

export type CostsPillKind =
  'draft' | 'open' | 'paid' | 'overdue' | 'booked' | 'disputed' | 'cancelled' | 'credit_note' | null

export interface CostsPill {
  readonly kind: CostsPillKind
  /** Days overdue when kind is `overdue`; otherwise null. */
  readonly daysOverdue: number | null
}

/**
 * A bill is past due when it still has an outstanding amount, is not a draft or
 * cancelled, and the due date is strictly before asOf (#119).
 */
export function isCostsOverdue(
  invoice: Pick<CostsInvoiceRow, 'status' | 'dueDate' | 'outstanding'>,
  asOf: string,
): boolean {
  if (invoice.status === 'draft' || invoice.status === 'cancelled') return false
  if (invoice.outstanding === '0') return false
  return invoice.dueDate < asOf
}

export function costsSegmentOf(
  invoice: Pick<CostsInvoiceRow, 'status' | 'outstanding'>,
): CostsSegment | null {
  if (invoice.status === 'cancelled') return null
  if (invoice.status === 'draft') return 'all'
  if (invoice.outstanding !== '0') return 'open'
  return 'paid'
}

export function countCostsSegments(invoices: readonly CostsInvoiceRow[]): CostsSegmentCounts {
  let all = 0
  let open = 0
  let paid = 0
  for (const invoice of invoices) {
    const segment = costsSegmentOf(invoice)
    if (segment === null) continue
    all += 1
    if (segment === 'open') open += 1
    else if (segment === 'paid') paid += 1
  }
  return { all, open, paid }
}

export function countAwaitingApproval(invoices: readonly CostsInvoiceRow[]): number {
  return invoices.filter((row) => row.status === 'booked').length
}

/**
 * Filter the list for the active tab + segment + free-text query.
 *
 * The To approve tab shows booked rows only (awaiting fiat). Bills uses the
 * All / To pay / Paid segments. Cancelled rows never appear.
 */
export function filterCostsInvoices(
  invoices: readonly CostsInvoiceRow[],
  tab: CostsTab,
  segment: CostsSegment,
  query: string,
): readonly CostsInvoiceRow[] {
  const needle = query.trim().toLowerCase()
  return invoices.filter((invoice) => {
    if (invoice.status === 'cancelled') return false
    if (tab === 'approve') {
      if (invoice.status !== 'booked') return false
    } else {
      const seat = costsSegmentOf(invoice)
      if (seat === null) return false
      if (segment === 'open' && seat !== 'open') return false
      if (segment === 'paid' && seat !== 'paid') return false
      // `all` includes drafts + open + paid.
    }
    if (needle === '') return true
    const hay = [
      invoice.supplierInvoiceNumber,
      invoice.contactName,
      invoice.contactNumber,
      invoice.total,
      invoice.outstanding,
    ]
      .join(' ')
      .toLowerCase()
    return hay.includes(needle)
  })
}

/**
 * Status pill for a list or preview row.
 *
 * Colours follow the export StatusPill set only: paid (success), late/overdue
 * (danger), open (info), draft (neutral). Booked / disputed / cancelled /
 * credit note use the same badge variants without inventing new hues.
 */
export function costsPill(
  invoice: Pick<CostsInvoiceRow, 'kind' | 'status' | 'dueDate' | 'outstanding'>,
  asOf: string,
): CostsPill {
  if (invoice.status === 'cancelled') return { kind: 'cancelled', daysOverdue: null }
  if (invoice.status === 'draft') return { kind: 'draft', daysOverdue: null }
  if (invoice.kind === 'credit_note' && invoice.outstanding === '0') {
    return { kind: 'credit_note', daysOverdue: null }
  }
  if (invoice.status === 'disputed') return { kind: 'disputed', daysOverdue: null }
  if (isCostsOverdue(invoice, asOf)) {
    const days = daysBetweenIso(invoice.dueDate, asOf)
    return { kind: 'overdue', daysOverdue: days > 0 ? days : null }
  }
  if (invoice.outstanding === '0') return { kind: 'paid', daysOverdue: null }
  if (invoice.status === 'booked') return { kind: 'booked', daysOverdue: null }
  return { kind: 'open', daysOverdue: null }
}

/** Sum minor-unit totals (string integers) for the footer. */
export function sumCostsTotals(invoices: readonly Pick<CostsInvoiceRow, 'total'>[]): bigint {
  return invoices.reduce((sum, row) => sum + BigInt(row.total), 0n)
}

/** Sum outstanding for the overdue callout. */
export function sumCostsOutstanding(
  invoices: readonly Pick<CostsInvoiceRow, 'outstanding'>[],
): bigint {
  return invoices.reduce((sum, row) => sum + BigInt(row.outstanding), 0n)
}

export function overdueCostsInvoices(
  invoices: readonly CostsInvoiceRow[],
  asOf: string,
): readonly CostsInvoiceRow[] {
  return invoices.filter((row) => isCostsOverdue(row, asOf))
}

/**
 * Honest approval line for the preview — never "waiting for a second person"
 * because bill approval is not four-eyes server-side (#128 notes / core model).
 */
export type CostsApprovalKind = 'draft' | 'booked' | 'approved' | 'disputed' | 'cancelled' | 'none'

export function costsApprovalKind(status: CostsInvoiceRow['status']): CostsApprovalKind {
  if (status === 'draft') return 'draft'
  if (status === 'booked') return 'booked'
  if (status === 'approved') return 'approved'
  if (status === 'disputed') return 'disputed'
  if (status === 'cancelled') return 'cancelled'
  return 'none'
}

/** Payable and still owed — the only rows "Go to payment batches" may claim. */
export function showCostsAddToBatch(
  invoice: Pick<CostsInvoiceRow, 'payable' | 'outstanding' | 'status'>,
): boolean {
  return invoice.payable && invoice.outstanding !== '0' && invoice.status === 'approved'
}

export function showCostsApprove(invoice: Pick<CostsInvoiceRow, 'status'>): boolean {
  return invoice.status === 'booked'
}

export function showCostsDispute(invoice: Pick<CostsInvoiceRow, 'status'>): boolean {
  return invoice.status === 'booked' || invoice.status === 'approved'
}
