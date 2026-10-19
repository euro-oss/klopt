/**
 * Import findings screen helpers (redesign slice 4 / #61).
 *
 * Pure shapes for the honesty grid, progress steps, and empty/loading/error
 * chrome that the prototype's `#/findings` screen uses. Callers still own the
 * FindingCard models from `~/lib/finding-card` / `moneybird-findings`.
 */

import type { FindingHonesty } from '~/lib/finding-card'

/** One cell in “Wat we gelezen hebben”. */
export interface HonestySource {
  readonly id: string
  readonly label: string
  /** Already localised count line, e.g. `412 gelezen` or `HTTP 403`. */
  readonly count: string
  readonly honesty: FindingHonesty
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

/** Wire counts + reconciliation → honesty grid cells (Moneybird-shaped). */
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
  }
  readonly onReread?: () => void
}): readonly HonestySource[] {
  const sales = input.counts['salesInvoices'] ?? 0
  const purchases =
    (input.counts['purchaseInvoices'] ?? 0) + (input.counts['documents'] ?? 0)
  const year = input.reconciliation[0]
  const yearHonesty: FindingHonesty =
    year === undefined
      ? 'empty'
      : year.source === 'unreadable'
        ? 'unread'
        : year.source === 'empty'
          ? 'empty'
          : year.balanced === true
            ? 'reconciled'
            : 'empty'

  const sources: HonestySource[] = [
    {
      id: 'sales',
      label: input.labels.sales,
      count: input.labels.readCount(sales),
      honesty: sales > 0 ? 'reconciled' : 'empty',
    },
    {
      id: 'purchases',
      label: input.labels.purchases,
      count: input.labels.readCount(purchases),
      honesty: purchases > 0 ? 'reconciled' : 'empty',
    },
  ]

  if (year !== undefined) {
    sources.push({
      id: `year-${String(year.year)}`,
      label: input.labels.bookings(year.year),
      count:
        year.source === 'unreadable'
          ? year.source
          : year.source === 'empty'
            ? input.labels.zeroRead
            : input.labels.readCount(1),
      honesty: yearHonesty,
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

/** VAT radio options for the category + btw sheet (prototype labels). */
export const IMPORT_VAT_OPTIONS = [
  { code: 'VH21', rate: '21' },
  { code: 'VL9', rate: '9' },
  { code: 'GEEN', rate: '0' },
] as const

export type ImportVatCode = (typeof IMPORT_VAT_OPTIONS)[number]['code']
