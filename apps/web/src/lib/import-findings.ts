/**
 * Import findings screen helpers (redesign slice 4 / #61).
 *
 * Pure shapes for the honesty grid, progress steps, and empty/loading/error
 * chrome that the prototype's `#/findings` screen uses. Callers still own the
 * FindingCard models from `~/lib/finding-card` / `moneybird-findings`.
 */

import { matchVatCodes, type VatMatchRule } from '@klopt/core/moneybird-account-ranker'
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

/** Tax-rule shape for the btw sheet — entity chart codes + optional label. */
export interface ImportVatRule extends VatMatchRule {
  readonly description?: string
}

/** One radio in the direction-filtered btw picker. */
export interface ImportVatOption {
  readonly code: string
  readonly rate: string
  readonly description: string
  readonly direction: 'input' | 'output'
}

/** Klopt tax code string (nl-mkb: H21, VERL, ICP, …). */
export type ImportVatCode = string

/**
 * Subset of `reference-data/charts/nl-mkb.json` for lab / unit tests.
 * Real Moneybird screens pass the entity's `listTaxCodes` rows instead.
 */
export const NL_MKB_VAT_RULES: readonly ImportVatRule[] = [
  { code: 'H21', rateBasisPoints: 2100, direction: 'output', description: 'BTW hoog 21%' },
  { code: 'L9', rateBasisPoints: 900, direction: 'output', description: 'BTW laag 9%' },
  {
    code: 'VERL',
    rateBasisPoints: 0,
    direction: 'output',
    description: 'BTW verlegd naar afnemer',
  },
  { code: 'GEEN', rateBasisPoints: 0, direction: 'output', description: 'Vrijgesteld van BTW' },
  {
    code: 'NUL',
    rateBasisPoints: 0,
    direction: 'output',
    description: 'BTW 0% (export buiten de EU)',
  },
  {
    code: 'ICP',
    rateBasisPoints: 0,
    direction: 'output',
    description: 'Intracommunautaire levering goederen 0%',
  },
  {
    code: 'ICPD',
    rateBasisPoints: 0,
    direction: 'output',
    description: 'Intracommunautaire dienst 0%',
  },
  {
    code: 'VH21',
    rateBasisPoints: 2100,
    direction: 'input',
    description: 'Voorbelasting hoog 21%',
  },
  { code: 'VL9', rateBasisPoints: 900, direction: 'input', description: 'Voorbelasting laag 9%' },
]

/**
 * VAT radios from the entity chart via core `matchVatCodes` (#69 PM).
 *
 * Empty / NaN percentage or unknown direction → [] (map by hand). Multiple
 * 0% sales matches (VERL/GEEN/NUL/ICP/ICPD) are all returned; never prefill.
 */
export function vatOptionsFor(input: {
  readonly rules: readonly ImportVatRule[]
  readonly taxRateType?: string | null
  readonly percentage?: string | null
}): readonly ImportVatOption[] {
  const taxRateType = input.taxRateType ?? null
  if (taxRateType !== 'purchase_invoice' && taxRateType !== 'sales_invoice') return []

  const raw = (input.percentage ?? '').trim().replace(',', '.')
  if (raw === '') return []
  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) return []

  return matchVatCodes(input.rules, { percentage: numeric, taxRateType }).map((rule) => {
    const withLabel = input.rules.find((row) => row.code === rule.code)
    return {
      code: rule.code,
      rate: (rule.rateBasisPoints / 100).toFixed(rule.rateBasisPoints % 100 === 0 ? 0 : 2),
      description: withLabel?.description?.trim() || rule.code,
      direction: rule.direction,
    }
  })
}

/**
 * Prefill only when exactly one chart code matches. Never pick GEEN (or any
 * other) among several 0% sales candidates.
 */
export function suggestVatCode(input: {
  readonly rules: readonly ImportVatRule[]
  readonly taxRateType?: string | null
  readonly percentage?: string | null
}): ImportVatCode | null {
  const options = vatOptionsFor(input)
  return options.length === 1 ? (options[0]?.code ?? null) : null
}
