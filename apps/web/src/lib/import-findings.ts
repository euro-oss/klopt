/**
 * Import findings screen helpers (redesign slice 4 / #61).
 *
 * Pure shapes for the honesty grid, progress steps, and empty/loading/error
 * chrome that the prototype's `#/findings` screen uses. Callers still own the
 * FindingCard models from `~/lib/finding-card` / `moneybird-findings`.
 */

import { rankVatCodes, type VatMatchRule } from '@klopt/core/moneybird-account-ranker'
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
  readonly proRataBasisPoints?: number | null
}

/** One radio in the direction-filtered btw picker. */
export interface ImportVatOption {
  readonly code: string
  readonly rate: string
  readonly description: string
  readonly direction: 'input' | 'output'
  readonly group: 'primary' | 'other'
  readonly deductibility?: string
  readonly proRataBasisPoints?: number | null
}

/** Primary then other — for the sheet and “Andere codes tonen” (#71). */
export interface ImportVatCandidates {
  readonly primary: readonly ImportVatOption[]
  readonly other: readonly ImportVatOption[]
  /** Unique plain standard only — never a 0% sales code. */
  readonly suggestedCode: string | null
}

/** Klopt tax code string (nl-mkb: H21, VERL, ICP, …). */
export type ImportVatCode = string

/**
 * Shape returned by `listTaxCodes` / chart JSON — enough for `rankVatCodes`.
 * Defaults mirror `loadChart` / DB (`reverseCharge` and `deductibility`).
 */
export interface ListTaxCodeRow {
  readonly code: string
  readonly description?: string
  readonly rateBasisPoints: number
  readonly direction: 'input' | 'output'
  readonly scope?: string
  readonly reverseCharge?: string
  readonly deductibility?: string
  readonly deductionCode?: string | null
  readonly proRataBasisPoints?: number | null
}

/** Map listTaxCodes / chart rows into picker rules (incl. deductionCode). */
export function importVatRulesFromListTaxCodes(
  rows: readonly ListTaxCodeRow[],
): readonly ImportVatRule[] {
  return rows.map((row): ImportVatRule => {
    const rule: ImportVatRule = {
      code: row.code,
      rateBasisPoints: row.rateBasisPoints,
      direction: row.direction,
      scope: row.scope ?? 'domestic',
      reverseCharge: row.reverseCharge ?? 'none',
      deductibility: row.deductibility ?? 'full',
    }
    if (row.description !== undefined && row.description !== '') {
      return {
        ...rule,
        description: row.description,
        ...(row.deductionCode !== undefined &&
        row.deductionCode !== null &&
        row.deductionCode !== ''
          ? { deductionCode: row.deductionCode }
          : {}),
        ...(row.proRataBasisPoints !== undefined
          ? { proRataBasisPoints: row.proRataBasisPoints }
          : {}),
      }
    }
    return {
      ...rule,
      ...(row.deductionCode !== undefined && row.deductionCode !== null && row.deductionCode !== ''
        ? { deductionCode: row.deductionCode }
        : {}),
      ...(row.proRataBasisPoints !== undefined
        ? { proRataBasisPoints: row.proRataBasisPoints }
        : {}),
    }
  })
}

/**
 * Full `reference-data/charts/nl-mkb.json` tax codes, shaped like `listTaxCodes`
 * (defaults for omitted reverseCharge / deductibility match DB + loadChart).
 * Keep in sync with the chart file — unit tests assert against the JSON.
 */
export const NL_MKB_VAT_RULES: readonly ImportVatRule[] = importVatRulesFromListTaxCodes([
  {
    code: 'H21',
    description: 'BTW hoog 21%',
    rateBasisPoints: 2100,
    direction: 'output',
    scope: 'domestic',
  },
  {
    code: 'L9',
    description: 'BTW laag 9%',
    rateBasisPoints: 900,
    direction: 'output',
    scope: 'domestic',
  },
  {
    code: 'PRIV21',
    description: 'Privégebruik 21%',
    rateBasisPoints: 2100,
    direction: 'output',
    scope: 'private_use',
  },
  {
    code: 'VERL',
    description: 'BTW verlegd naar afnemer',
    rateBasisPoints: 0,
    direction: 'output',
    scope: 'domestic',
    reverseCharge: 'domestic',
  },
  {
    code: 'GEEN',
    description: 'Vrijgesteld van BTW',
    rateBasisPoints: 0,
    direction: 'output',
    scope: 'exempt',
  },
  {
    code: 'NUL',
    description: 'BTW 0% (export buiten de EU)',
    rateBasisPoints: 0,
    direction: 'output',
    scope: 'export',
  },
  {
    code: 'ICP',
    description: 'Intracommunautaire levering goederen 0%',
    rateBasisPoints: 0,
    direction: 'output',
    scope: 'intra_community_supply',
  },
  {
    code: 'ICPD',
    description: 'Intracommunautaire dienst 0%',
    rateBasisPoints: 0,
    direction: 'output',
    scope: 'intra_community_supply',
  },
  {
    code: 'VH21',
    description: 'Voorbelasting hoog 21%',
    rateBasisPoints: 2100,
    direction: 'input',
    scope: 'domestic',
    deductibility: 'full',
  },
  {
    code: 'VL9',
    description: 'Voorbelasting laag 9%',
    rateBasisPoints: 900,
    direction: 'input',
    scope: 'domestic',
    deductibility: 'full',
  },
  {
    code: 'VERL-ONTV',
    description: 'BTW verlegd naar u, verschuldigd',
    rateBasisPoints: 2100,
    direction: 'input',
    scope: 'domestic',
    reverseCharge: 'domestic',
    deductionCode: 'VERL-VOOR',
  },
  {
    code: 'VERL-VOOR',
    description: 'BTW verlegd naar u, voorbelasting',
    rateBasisPoints: 2100,
    direction: 'input',
    scope: 'domestic',
    deductibility: 'full',
  },
  {
    code: 'ICV21',
    description: 'Intracommunautaire verwerving 21%, verschuldigd',
    rateBasisPoints: 2100,
    direction: 'input',
    scope: 'intra_community_acquisition',
    deductionCode: 'ICV21-VOOR',
  },
  {
    code: 'ICV21-VOOR',
    description: 'Intracommunautaire verwerving 21%, voorbelasting',
    rateBasisPoints: 2100,
    direction: 'input',
    scope: 'intra_community_acquisition',
    deductibility: 'full',
  },
  {
    code: 'INV23',
    description: 'Invoer met artikel 23-verlegging, verschuldigd',
    rateBasisPoints: 2100,
    direction: 'input',
    scope: 'import',
    reverseCharge: 'import_article_23',
    deductionCode: 'INV23-VOOR',
  },
  {
    code: 'INV23-VOOR',
    description: 'Invoer met artikel 23-verlegging, voorbelasting',
    rateBasisPoints: 2100,
    direction: 'input',
    scope: 'import',
    deductibility: 'full',
  },
])

/**
 * Codes named as another code's `deductionCode` (VERL-VOOR, ICV21-VOOR, …).
 * Offering a half alone books voorbelasting without the verschuldigde btw (#71 PM).
 */
function deductionHalfCodes(rules: readonly VatMatchRule[]): ReadonlySet<string> {
  return new Set(
    rules
      .map((entry) => entry.deductionCode)
      .filter((code): code is string => typeof code === 'string' && code !== ''),
  )
}

/**
 * Import picker filter: PRIV21 out (mapping turnover to PRIV21 moves revenue
 * from rubriek 1a → 1d — PM amendment on #70). Deduction halves out (offer
 * VERL-ONTV / ICV21 / INV23 which carry the pairing).
 */
function showInVatPicker(rule: VatMatchRule, halves: ReadonlySet<string>): boolean {
  if (rule.scope === 'private_use') return false
  return !halves.has(rule.code)
}

function toVatOption(
  rule: VatMatchRule,
  rules: readonly ImportVatRule[],
  group: 'primary' | 'other',
): ImportVatOption {
  const withLabel = rules.find((row) => row.code === rule.code)
  return {
    code: rule.code,
    rate: (rule.rateBasisPoints / 100).toFixed(rule.rateBasisPoints % 100 === 0 ? 0 : 2),
    description: withLabel?.description?.trim() || rule.code,
    direction: rule.direction,
    group,
    ...(rule.deductibility !== undefined ? { deductibility: rule.deductibility } : {}),
    ...(withLabel?.proRataBasisPoints !== undefined
      ? { proRataBasisPoints: withLabel.proRataBasisPoints }
      : {}),
  }
}

/**
 * Direction + rate matches via `rankVatCodes`: primary (H21/L9/VH21/VL9) first,
 * then other (0% sales, VERL-ONTV / ICV21 / INV23, …). PRIV21 and deduction
 * halves are never offered (#71).
 *
 * Empty / NaN percentage or unknown direction → empty groups (map by hand).
 */
export function vatCandidatesFor(input: {
  readonly rules: readonly ImportVatRule[]
  readonly taxRateType?: string | null
  readonly percentage?: string | null
}): ImportVatCandidates {
  const taxRateType = input.taxRateType ?? null
  if (taxRateType !== 'purchase_invoice' && taxRateType !== 'sales_invoice') {
    return { primary: [], other: [], suggestedCode: null }
  }

  const raw = (input.percentage ?? '').trim().replace(',', '.')
  if (raw === '') return { primary: [], other: [], suggestedCode: null }
  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) return { primary: [], other: [], suggestedCode: null }

  const halves = deductionHalfCodes(input.rules)
  const ranked = rankVatCodes(input.rules, { percentage: numeric, taxRateType })
  const primary = ranked.primary
    .filter((rule) => showInVatPicker(rule, halves))
    .map((rule) => toVatOption(rule, input.rules, 'primary'))
  const other = ranked.other
    .filter((rule) => showInVatPicker(rule, halves))
    .map((rule) => toVatOption(rule, input.rules, 'other'))
  const suggestedCode =
    ranked.suggestedCode !== null && primary.some((row) => row.code === ranked.suggestedCode)
      ? ranked.suggestedCode
      : primary.length === 1
        ? (primary[0]?.code ?? null)
        : null
  return { primary, other, suggestedCode }
}

/**
 * Flat primary+other list (PRIV21 excluded). Prefer {@link vatCandidatesFor}
 * when the UI needs the toggle split.
 */
export function vatOptionsFor(input: {
  readonly rules: readonly ImportVatRule[]
  readonly taxRateType?: string | null
  readonly percentage?: string | null
}): readonly ImportVatOption[] {
  const ranked = vatCandidatesFor(input)
  return [...ranked.primary, ...ranked.other]
}

/**
 * Prefill only a unique primary. Never pick among 0% sales (all `other`).
 */
export function suggestVatCode(input: {
  readonly rules: readonly ImportVatRule[]
  readonly taxRateType?: string | null
  readonly percentage?: string | null
}): ImportVatCode | null {
  return vatCandidatesFor(input).suggestedCode
}
