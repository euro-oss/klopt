/**
 * Sales list segmentation and preview helpers (#107 Phase 2).
 *
 * Segments ship as Drafts / Open / Overdue only — Paid needs `outstanding` and
 * `paidOn` on the invoice list ([API] gap). Overdue uses the existing overdue
 * report set (outstanding after bank allocations), not a client-side guess.
 */

export type SalesSegment = 'draft' | 'open' | 'overdue'

export interface SalesInvoiceRow {
  readonly id: string
  readonly kind: 'invoice' | 'credit_note'
  readonly status: 'draft' | 'issued' | 'cancelled'
  readonly number: string | null
  readonly issueDate: string
  readonly dueDate: string
  readonly total: string
  readonly currency: string
  readonly contactNumber: string
  readonly contactName: string
}

export interface SalesSegmentCounts {
  readonly draft: number
  readonly open: number
  readonly overdue: number
}

export type InvoicePillKind = 'draft' | 'open' | 'overdue' | 'cancelled' | 'credit_note' | null

export interface InvoicePill {
  readonly kind: InvoicePillKind
  /** Days overdue when kind is `overdue`; otherwise null. */
  readonly daysOverdue: number | null
}

export interface DeliveryRecord {
  readonly id: string
  readonly purpose: 'invoice' | 'reminder'
  readonly delivered: boolean
  readonly channel: string
  readonly transport: string
  readonly sentAt: string
  readonly stageLabel: string | null
  readonly tone: 'reminder' | 'demand' | 'final' | null
  readonly failure: string | null
}

export type SentAsKind = 'email_pdf_ubl' | 'not_delivered'

export interface SentAs {
  readonly kind: SentAsKind
}

export type HistoryEventKind =
  'issued' | 'sent' | 'send_failed' | 'reminder' | 'due_unpaid' | 'next_reminder'

export interface HistoryEvent {
  readonly kind: HistoryEventKind
  readonly when: string | null
  /** Reminder stage tone when kind is reminder / next_reminder. */
  readonly tone: 'reminder' | 'demand' | 'final' | null
  readonly stageLabel: string | null
  readonly daysOverdue: number | null
}

/** Days between two ISO dates (`to - from`), calendar days in UTC. */
export function daysBetweenIso(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/**
 * Classify one invoice into a Sales segment.
 *
 * Cancelled invoices are omitted (null) — no cancelled segment until PM adds
 * one. Credit notes that are still issued follow open/overdue like invoices.
 */
export function salesSegmentOf(
  invoice: Pick<SalesInvoiceRow, 'id' | 'status'>,
  overdueIds: ReadonlySet<string>,
): SalesSegment | null {
  if (invoice.status === 'draft') return 'draft'
  if (invoice.status === 'cancelled') return null
  if (overdueIds.has(invoice.id)) return 'overdue'
  if (invoice.status === 'issued') return 'open'
  return null
}

export function countSalesSegments(
  invoices: readonly SalesInvoiceRow[],
  overdueIds: ReadonlySet<string>,
): SalesSegmentCounts {
  let draft = 0
  let open = 0
  let overdue = 0
  for (const invoice of invoices) {
    const segment = salesSegmentOf(invoice, overdueIds)
    if (segment === 'draft') draft += 1
    else if (segment === 'open') open += 1
    else if (segment === 'overdue') overdue += 1
  }
  return { draft, open, overdue }
}

export function filterSalesInvoices(
  invoices: readonly SalesInvoiceRow[],
  overdueIds: ReadonlySet<string>,
  segment: SalesSegment,
  query: string,
): readonly SalesInvoiceRow[] {
  const needle = query.trim().toLowerCase()
  return invoices.filter((invoice) => {
    if (salesSegmentOf(invoice, overdueIds) !== segment) return false
    if (needle === '') return true
    const hay = [invoice.number ?? '', invoice.contactName, invoice.contactNumber, invoice.total]
      .join(' ')
      .toLowerCase()
    return hay.includes(needle)
  })
}

/**
 * Status pill for a list or preview row.
 *
 * Only statuses the API returns: draft / issued / cancelled, plus kind
 * credit_note. Overdue days come from the overdue set (or dueDate vs asOf when
 * the invoice is known overdue). Paid pills are an [API] gap.
 */
export function invoicePill(
  invoice: Pick<SalesInvoiceRow, 'id' | 'kind' | 'status' | 'dueDate'>,
  overdueIds: ReadonlySet<string>,
  asOf: string,
): InvoicePill {
  if (invoice.status === 'draft') return { kind: 'draft', daysOverdue: null }
  if (invoice.status === 'cancelled') return { kind: 'cancelled', daysOverdue: null }
  if (invoice.kind === 'credit_note') return { kind: 'credit_note', daysOverdue: null }
  if (overdueIds.has(invoice.id)) {
    const days = daysBetweenIso(invoice.dueDate, asOf)
    return { kind: 'overdue', daysOverdue: days > 0 ? days : null }
  }
  if (invoice.status === 'issued') return { kind: 'open', daysOverdue: null }
  return { kind: null, daysOverdue: null }
}

/**
 * "Sent as" from delivery records only.
 *
 * No delivery → omit the row entirely (never invent Peppol or a channel).
 * A recorded attempt with `delivered: false` → not delivered.
 * A successful email delivery → email with PDF and UBL (what the transport
 * actually attaches). Nothing says Peppol.
 */
export function sentAsFromDeliveries(deliveries: readonly DeliveryRecord[]): SentAs | null {
  const invoiceDeliveries = deliveries.filter((row) => row.purpose === 'invoice')
  if (invoiceDeliveries.length === 0) return null
  const latest = invoiceDeliveries.reduce((best, row) => (row.sentAt > best.sentAt ? row : best))
  if (!latest.delivered) return { kind: 'not_delivered' }
  return { kind: 'email_pdf_ubl' }
}

/**
 * History timeline from deliveries + overdue state. No paid / bank-match step
 * without `paidOn` ([API] gap). Missing events are omitted, never placeholder.
 */
export function invoiceHistoryEvents(input: {
  readonly issueDate: string
  readonly dueDate: string
  readonly status: 'draft' | 'issued' | 'cancelled'
  readonly overdue: boolean
  readonly daysOverdue: number | null
  readonly deliveries: readonly DeliveryRecord[]
  readonly nextReminder: {
    readonly tone: 'reminder' | 'demand' | 'final'
    readonly stageLabel: string
  } | null
}): readonly HistoryEvent[] {
  const events: HistoryEvent[] = []

  if (input.status !== 'draft') {
    events.push({
      kind: 'issued',
      when: input.issueDate,
      tone: null,
      stageLabel: null,
      daysOverdue: null,
    })
  }

  for (const delivery of [...input.deliveries].sort((a, b) => a.sentAt.localeCompare(b.sentAt))) {
    if (delivery.purpose === 'invoice') {
      events.push({
        kind: delivery.delivered ? 'sent' : 'send_failed',
        when: delivery.sentAt.slice(0, 10),
        tone: null,
        stageLabel: null,
        daysOverdue: null,
      })
      continue
    }
    events.push({
      kind: 'reminder',
      when: delivery.sentAt.slice(0, 10),
      tone: delivery.tone,
      stageLabel: delivery.stageLabel,
      daysOverdue: null,
    })
  }

  if (input.overdue) {
    events.push({
      kind: 'due_unpaid',
      when: input.dueDate,
      tone: null,
      stageLabel: null,
      daysOverdue: input.daysOverdue,
    })
  }

  if (input.nextReminder !== null) {
    events.push({
      kind: 'next_reminder',
      when: null,
      tone: input.nextReminder.tone,
      stageLabel: input.nextReminder.stageLabel,
      daysOverdue: null,
    })
  }

  return events
}

/** Sum minor-unit totals (string integers) for the footer. */
export function sumInvoiceTotals(invoices: readonly Pick<SalesInvoiceRow, 'total'>[]): bigint {
  return invoices.reduce((sum, row) => sum + BigInt(row.total), 0n)
}
