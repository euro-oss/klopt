/**
 * Contacts list helpers (#107 Phase 6 / #130 / #195 item 1).
 *
 * Role tabs and search are client-side: `listContacts` only offers
 * `customersOnly`, not suppliers or a free-text filter ([API]). Customer open
 * amounts use sales `outstanding` from `listInvoices`; supplier open uses
 * purchase `outstanding`.
 */

export type ContactsRoleFilter = 'all' | 'customers' | 'suppliers'

export interface ContactListRow {
  readonly id: string
  readonly number: string
  readonly name: string
  readonly isCustomer: boolean
  readonly isSupplier: boolean
  readonly email: string | null
  readonly vatNumber: string | null
  readonly countryCode: string
  readonly paymentTermsDays: number
  readonly isBlocked: boolean
}

export interface ContactRoleCounts {
  readonly all: number
  readonly customers: number
  readonly suppliers: number
}

export interface ContactSalesDoc {
  readonly id: string
  readonly number: string | null
  readonly total: string
  /** Still owed on issued invoices (total − allocations − linked credit notes). */
  readonly outstanding: string
  readonly contactNumber: string
  readonly status: 'draft' | 'issued' | 'cancelled'
  readonly kind: 'invoice' | 'credit_note'
  readonly dueDate: string
}

export interface ContactPurchaseDoc {
  readonly id: string
  readonly contactNumber: string
  readonly total: string
  readonly outstanding: string
  readonly dueDate: string
  readonly status: string
}

export interface ContactOverdueRow {
  readonly id: string
  readonly contactName: string
  readonly total: string
  readonly daysOverdue: number
}

export interface ContactAggregate {
  /** Sum of sales invoice totals (customers) or purchase totals (suppliers). */
  readonly volumeMinor: bigint
  readonly documentCount: number
  /** Open sales outstanding (customers) or purchase outstanding (suppliers). */
  readonly openMinor: bigint
  /** Days late of the oldest overdue sales invoice, when any. */
  readonly lateDays: number | null
}

/**
 * Status pills on the contact card (#107 / #130).
 *
 * Only values from `invoice_status` (`draft` | `issued` | `cancelled` in
 * `packages/db/src/schema/sales.ts`). No paid / partly-paid / late — those are
 * not on the enum; for outstanding issued invoices the UI shows plain
 * "Open € …" text instead of inventing a pill from allocations.
 */
export type ContactDocPillKind = 'draft' | 'cancelled'

export interface ContactDocStatus {
  /** API status pill, or null when the row should show open-amount text. */
  readonly pill: ContactDocPillKind | null
  /** Outstanding minor units when the invoice is still open; else null. */
  readonly openMinor: bigint | null
}

const ROLE_FILTERS: readonly ContactsRoleFilter[] = ['all', 'customers', 'suppliers']

export function parseContactsRoleFilter(value: unknown): ContactsRoleFilter {
  return ROLE_FILTERS.includes(value as ContactsRoleFilter) ? (value as ContactsRoleFilter) : 'all'
}

/** Initials from the first two words, letters only — matches the export. */
export function contactInitials(name: string): string {
  return name
    .replace(/[^A-Za-zÀ-ÿ ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
}

export function countContactRoles(rows: readonly ContactListRow[]): ContactRoleCounts {
  let customers = 0
  let suppliers = 0
  for (const row of rows) {
    if (row.isCustomer) customers += 1
    if (row.isSupplier) suppliers += 1
  }
  return { all: rows.length, customers, suppliers }
}

export function filterContacts(
  rows: readonly ContactListRow[],
  role: ContactsRoleFilter,
  query: string,
): readonly ContactListRow[] {
  const needle = query.trim().toLowerCase()
  return rows.filter((row) => {
    if (role === 'customers' && !row.isCustomer) return false
    if (role === 'suppliers' && !row.isSupplier) return false
    if (needle === '') return true
    const hay = [row.name, row.number, row.vatNumber ?? '', row.email ?? '', row.countryCode]
      .join(' ')
      .toLowerCase()
    return hay.includes(needle)
  })
}

function salesOpenMinor(doc: Pick<ContactSalesDoc, 'status' | 'kind' | 'outstanding'>): bigint {
  if (doc.status !== 'issued' || doc.kind !== 'invoice') return 0n
  const open = BigInt(doc.outstanding)
  return open > 0n ? open : 0n
}

/**
 * Volume / document / open figures keyed by contact number.
 *
 * Customer open sums issued invoice `outstanding`. Overdue rows contribute
 * `lateDays` only (matched by invoice id, then by contact name).
 */
export function aggregateContacts(
  contacts: readonly ContactListRow[],
  sales: readonly ContactSalesDoc[],
  purchases: readonly ContactPurchaseDoc[],
  overdue: readonly ContactOverdueRow[],
): ReadonlyMap<string, ContactAggregate> {
  const byNumber = new Map<string, ContactAggregate>()

  const empty = (): ContactAggregate => ({
    volumeMinor: 0n,
    documentCount: 0,
    openMinor: 0n,
    lateDays: null,
  })

  const bump = (
    number: string,
    patch: {
      volume?: bigint
      documents?: number
      open?: bigint
      lateDays?: number
    },
  ): void => {
    const current = byNumber.get(number) ?? empty()
    const late =
      patch.lateDays === undefined
        ? current.lateDays
        : current.lateDays === null
          ? patch.lateDays
          : Math.max(current.lateDays, patch.lateDays)
    byNumber.set(number, {
      volumeMinor: current.volumeMinor + (patch.volume ?? 0n),
      documentCount: current.documentCount + (patch.documents ?? 0),
      openMinor: current.openMinor + (patch.open ?? 0n),
      lateDays: late,
    })
  }

  const salesById = new Map(sales.map((doc) => [doc.id, doc]))

  for (const invoice of sales) {
    bump(invoice.contactNumber, {
      volume: BigInt(invoice.total),
      documents: 1,
      open: salesOpenMinor(invoice),
    })
  }

  for (const bill of purchases) {
    bump(bill.contactNumber, {
      volume: BigInt(bill.total),
      documents: 1,
      open: BigInt(bill.outstanding),
    })
  }

  const numberByName = new Map<string, string>()
  for (const contact of contacts) {
    numberByName.set(contact.name, contact.number)
  }

  for (const row of overdue) {
    const linked = salesById.get(row.id)
    const number = linked?.contactNumber ?? numberByName.get(row.contactName)
    if (number === undefined) continue
    bump(number, { lateDays: row.daysOverdue })
  }

  return byNumber
}

export function contactRoleLabel(
  contact: Pick<ContactListRow, 'isCustomer' | 'isSupplier'>,
  labels: { customer: string; supplier: string; both: string },
): string {
  if (contact.isCustomer && contact.isSupplier) return labels.both
  if (contact.isCustomer) return labels.customer
  if (contact.isSupplier) return labels.supplier
  return labels.both
}

/**
 * Whether address + email (and IBAN for suppliers) are present enough for
 * EN 16931 / payment. Missing pieces surface as "Add details".
 */
export function missingEInvoicingDetails(contact: {
  readonly email: string | null
  readonly iban: string | null
  readonly isSupplier: boolean
  readonly address: {
    readonly street: string | null
    readonly postalCode: string | null
    readonly city: string | null
  } | null
}): boolean {
  const address = contact.address
  const hasAddress =
    address !== null &&
    (address.street ?? '') !== '' &&
    (address.postalCode ?? '') !== '' &&
    (address.city ?? '') !== ''
  if (!hasAddress) return true
  if ((contact.email ?? '') === '') return true
  if (contact.isSupplier && (contact.iban ?? '') === '') return true
  return false
}

/**
 * How to label one sales document on the contact card.
 *
 * Pills only for `draft` / `cancelled` (exact `invoice_status` values).
 * `issued` never gets a late/paid pill — when still open, surface outstanding
 * as plain open-amount text instead.
 */
export function salesDocStatus(
  doc: Pick<ContactSalesDoc, 'status' | 'kind' | 'outstanding'>,
): ContactDocStatus {
  if (doc.status === 'draft') return { pill: 'draft', openMinor: null }
  if (doc.status === 'cancelled') return { pill: 'cancelled', openMinor: null }
  const open = salesOpenMinor(doc)
  if (open > 0n) return { pill: null, openMinor: open }
  return { pill: null, openMinor: null }
}

/**
 * Whether the contact-level open figure should use overdue (red) styling.
 * Open amount stays normal ink until at least one sales invoice is late (`lateDays > 0`).
 */
export function contactOpenAmountIsOverdue(lateDays: number | null): boolean {
  return lateDays !== null && lateDays > 0
}

/**
 * Secondary line under an issued invoice open amount on the contact card (#195).
 *
 * Design: not-yet-due → muted “Vervalt {date}”; overdue → destructive late-days
 * line (open amount stays the real outstanding above); fully paid → neither.
 */
export type ContactInvoiceRowHint =
  | { readonly kind: 'due'; readonly dueDateIso: string }
  | { readonly kind: 'overdue'; readonly lateDays: number }

export function contactInvoiceRowHint(input: {
  readonly openMinor: bigint | null
  readonly dueDate: string
  readonly asOf: string
  readonly overdueDays: number | undefined
}): ContactInvoiceRowHint | null {
  if (input.openMinor === null || input.openMinor <= 0n) return null
  if (input.overdueDays !== undefined && input.overdueDays > 0) {
    return { kind: 'overdue', lateDays: input.overdueDays }
  }
  if (input.dueDate >= input.asOf && input.overdueDays === undefined) {
    return { kind: 'due', dueDateIso: input.dueDate }
  }
  return null
}

/**
 * Purchase-side open summary for the contact card (#163 Legal).
 *
 * Count and amount come only from purchase `outstanding` — never from
 * inventing a paid state. A bill is overdue only when `dueDate < asOf`
 * (same exclusive boundary as #118: daysOverdue > 0).
 */
export interface SupplierOpenSummary {
  readonly openCount: number
  readonly openMinor: bigint
  readonly overdueCount: number
}

export function supplierOpenSummary(
  purchases: readonly ContactPurchaseDoc[],
  asOf: string,
): SupplierOpenSummary {
  let openCount = 0
  let openMinor = 0n
  let overdueCount = 0
  for (const bill of purchases) {
    const outstanding = BigInt(bill.outstanding)
    if (outstanding <= 0n) continue
    openCount += 1
    openMinor += outstanding
    if (bill.dueDate < asOf) overdueCount += 1
  }
  return { openCount, openMinor, overdueCount }
}

/** Fetch one past the display hint so the UI can show a truncated hint later. */
export const CONTACTS_DOCS_FETCH_LIMIT = 201
