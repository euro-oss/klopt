/**
 * Import findings screen helpers (redesign slice 4 / #61).
 *
 * Pure shapes for the honesty grid, progress steps, and empty/loading/error
 * chrome that the prototype's `#/findings` screen uses. Callers still own the
 * FindingCard models from `~/lib/finding-card` / `moneybird-findings`.
 */

import type { FindingHonesty } from '~/lib/finding-card'

/** Local copy of honestyFromReconciliation — keeps this module free of value imports from finding-card for vitest path alias. */
function honestyFromReconciliation(
  source: 'read' | 'empty' | 'unreadable',
  balanced: boolean | null | undefined,
): FindingHonesty | null {
  if (source === 'unreadable') return 'unread'
  if (source === 'empty') return 'empty'
  if (source === 'read' && balanced === true) return 'reconciled'
  return null
}

/** One cell in “Wat we gelezen hebben”. */
export interface HonestySource {
  readonly id: string
  readonly label: string
  /** Already localised count line, e.g. `412 gelezen` or `HTTP 403`. */
  readonly count: string
  /**
   * Honesty claim, or `null` when we only know a count was read and must not
   * paint Klopt / empty / unread (#41).
   */
  readonly honesty: FindingHonesty | null
  /** Optional action when unread (e.g. Opnieuw lezen). */
  readonly onReread?: () => void
}

export type ImportStepId = 'connect' | 'read' | 'review' | 'import'

export type ImportStepState = 'done' | 'current' | 'todo'

export interface ImportProgressStep {
  readonly id: ImportStepId
  readonly state: ImportStepState
}

/**
 * Progress strip for the import findings screen.
 *
 * Connect + read are done once a dry-run report exists; review is current while
 * findings remain; import is current only when nothing blocks.
 */
export function importProgressSteps(input: {
  readonly connected: boolean
  readonly hasPreview: boolean
  readonly blockingCount: number
  readonly importing?: boolean
}): readonly ImportProgressStep[] {
  if (!input.connected) {
    return [
      { id: 'connect', state: 'current' },
      { id: 'read', state: 'todo' },
      { id: 'review', state: 'todo' },
      { id: 'import', state: 'todo' },
    ]
  }
  if (!input.hasPreview) {
    return [
      { id: 'connect', state: 'done' },
      { id: 'read', state: 'current' },
      { id: 'review', state: 'todo' },
      { id: 'import', state: 'todo' },
    ]
  }
  if (input.importing === true) {
    return [
      { id: 'connect', state: 'done' },
      { id: 'read', state: 'done' },
      { id: 'review', state: 'done' },
      { id: 'import', state: 'current' },
    ]
  }
  if (input.blockingCount > 0) {
    return [
      { id: 'connect', state: 'done' },
      { id: 'read', state: 'done' },
      { id: 'review', state: 'current' },
      { id: 'import', state: 'todo' },
    ]
  }
  return [
    { id: 'connect', state: 'done' },
    { id: 'read', state: 'done' },
    { id: 'review', state: 'done' },
    { id: 'import', state: 'current' },
  ]
}

export interface ResolvedFindingRow {
  readonly id: string
  readonly code: string
  readonly title: string
  readonly result: string
}

/**
 * Wire counts + reconciliation → honesty grid cells (Moneybird-shaped).
 *
 * Only claims the report backs (#41/#42): sales/purchases show counts without
 * a Klopt badge; a year that does not balance surfaces that in the count line
 * and never paints as reconciled; unreadable years stay unread with a
 * localised count, not the raw `unreadable` string.
 */
export function honestySourcesFromMoneybird(input: {
  readonly counts: Readonly<Record<string, number>>
  readonly reconciliation: readonly {
    readonly year: number
    readonly source: 'read' | 'empty' | 'unreadable'
    readonly balanced: boolean | null
  }[]
  readonly unreadResource?: { readonly label: string; readonly detail: string } | null
  readonly labels: {
    readonly sales: string
    readonly purchases: string
    readonly bookings: (year: number) => string
    readonly readCount: (n: number) => string
    readonly zeroRead: string
    readonly unreadable: string
    readonly doesNotBalance: string
    readonly yearRead: string
  }
  readonly onReread?: () => void
}): readonly HonestySource[] {
  const sources: HonestySource[] = []

  if ('salesInvoices' in input.counts) {
    const sales = input.counts['salesInvoices'] ?? 0
    sources.push({
      id: 'sales',
      label: input.labels.sales,
      count: input.labels.readCount(sales),
      // Counts alone are not a reconciliation claim.
      honesty: null,
    })
  }

  if ('purchaseInvoices' in input.counts || 'documents' in input.counts) {
    const purchases = (input.counts['purchaseInvoices'] ?? 0) + (input.counts['documents'] ?? 0)
    sources.push({
      id: 'purchases',
      label: input.labels.purchases,
      count: input.labels.readCount(purchases),
      honesty: null,
    })
  }

  for (const year of input.reconciliation) {
    const honesty = honestyFromReconciliation(year.source, year.balanced)
    const count =
      year.source === 'unreadable'
        ? input.labels.unreadable
        : year.source === 'empty'
          ? input.labels.zeroRead
          : year.balanced === false
            ? input.labels.doesNotBalance
            : input.labels.yearRead
    sources.push({
      id: `year-${String(year.year)}`,
      label: input.labels.bookings(year.year),
      count,
      honesty,
      ...(year.source === 'unreadable' && input.onReread !== undefined
        ? { onReread: input.onReread }
        : {}),
    })
  }

  if (input.unreadResource !== null && input.unreadResource !== undefined) {
    sources.push({
      id: 'unread-resource',
      label: input.unreadResource.label,
      count: input.unreadResource.detail,
      honesty: 'unread',
      ...(input.onReread !== undefined ? { onReread: input.onReread } : {}),
    })
  }

  return sources
}

/** Exact dry-run → honesty cells from open-item reconciliation. */
export function honestySourcesFromExact(input: {
  readonly honesty: FindingHonesty | null
  readonly label: string
  readonly count: string
  readonly onReread?: () => void
}): readonly HonestySource[] {
  if (input.honesty === null) return []
  return [
    {
      id: 'exact-control',
      label: input.label,
      count: input.count,
      honesty: input.honesty,
      ...(input.honesty === 'unread' && input.onReread !== undefined
        ? { onReread: input.onReread }
        : {}),
    },
  ]
}

/** Catalogue of common nl-mkb VAT radios for the category + btw sheet. */
export const IMPORT_VAT_CATALOGUE = [
  { code: 'H21', rate: '21', direction: 'output' as const },
  { code: 'L9', rate: '9', direction: 'output' as const },
  { code: 'GEEN', rate: '0', direction: 'output' as const },
  { code: 'VH21', rate: '21', direction: 'input' as const },
  { code: 'VL9', rate: '9', direction: 'input' as const },
] as const

export type ImportVatCode = (typeof IMPORT_VAT_CATALOGUE)[number]['code']

/** @deprecated Prefer IMPORT_VAT_CATALOGUE + vatOptionsFor. */
export const IMPORT_VAT_OPTIONS = [
  { code: 'VH21' as const, rate: '21' },
  { code: 'VL9' as const, rate: '9' },
  { code: 'GEEN' as const, rate: '0' },
]

/**
 * VAT radios filtered by Moneybird direction and rate (#42 / proposeTaxCode).
 *
 * Rates other than 21 / 9 / 0 never fall back to 21%. Unknown rates return [].
 */
export function vatOptionsFor(input: {
  readonly taxRateType?: string | null
  readonly percentage?: string | null
}): readonly { readonly code: ImportVatCode; readonly rate: string }[] {
  const direction = input.taxRateType === 'purchase_invoice' ? 'input' : 'output'
  const raw = (input.percentage ?? '').trim().replace(',', '.')
  const numeric = raw === '' ? null : Number(raw)
  if (numeric === null || !Number.isFinite(numeric)) {
    return IMPORT_VAT_CATALOGUE.filter((option) => option.direction === direction).map(
      (option) => ({ code: option.code, rate: option.rate }),
    )
  }
  const rounded = Math.round(numeric)
  if (rounded !== 21 && rounded !== 9 && rounded !== 0) return []
  const rate = String(rounded)
  return IMPORT_VAT_CATALOGUE.filter(
    (option) => option.direction === direction && option.rate === rate,
  ).map((option) => ({ code: option.code, rate: option.rate }))
}

/** Suggest the first matching catalogue code for a Moneybird tax percentage. */
export function suggestVatCode(input: {
  readonly taxRateType?: string | null
  readonly percentage?: string | null
}): ImportVatCode | null {
  return vatOptionsFor(input)[0]?.code ?? null
}
