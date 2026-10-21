import type { Chart, ChartTaxCode } from '../setup/chart.js'

/**
 * Standard VAT codes an Eigenaar / Accountant may add to an administration.
 *
 * The allowlist is the shipped chart (`nl-mkb.json`), not free-form rates or
 * rubrieken. Pair halves that share a `deductionCode` link are offered and
 * inserted together, and only when neither half already exists — the same
 * atomicity migration 0036 and the Moneybird import sheet rely on.
 */

/**
 * Codes kept off new sales / purchase booking pickers.
 *
 * Historical correction rates and private use stay on the chart for import
 * mapping and late corrections, but the Beheer screen badges them so nobody
 * mistakes them for everyday booking choices.
 */
export const BOOKING_PICKER_EXCLUDED_CODES: ReadonlySet<string> = new Set([
  'PRIV21',
  'L6',
  'H19',
  'VL6',
  'VH19',
])

export function isCorrectionOrImportOnly(code: string): boolean {
  return BOOKING_PICKER_EXCLUDED_CODES.has(code)
}

/** One selectable offer: a single code, or an atomic pair. */
export interface TaxCodeOffer {
  /** Allowlist key posted to `POST /tax-codes`. The primary code of a pair. */
  readonly key: string
  readonly codes: readonly string[]
  readonly descriptions: readonly string[]
  readonly rateBasisPoints: number
  readonly direction: 'output' | 'input'
  readonly pair: boolean
  readonly correctionOnly: boolean
  /** Chart rows that will be inserted when this offer is accepted. */
  readonly entries: readonly ChartTaxCode[]
}

/**
 * Group chart tax codes into addable offers.
 *
 * A code that names a `deductionCode` present on the same chart forms a pair
 * with that half. Pair members are never offered alone. Everything else is a
 * single. Order follows the chart file.
 */
export function taxCodeOffersFromChart(chart: Chart): readonly TaxCodeOffer[] {
  const byCode = new Map(chart.taxCodes.map((entry) => [entry.code, entry] as const))
  const claimed = new Set<string>()
  const offers: TaxCodeOffer[] = []

  for (const entry of chart.taxCodes) {
    if (claimed.has(entry.code)) continue
    const partnerCode = entry.deductionCode
    if (partnerCode !== null && byCode.has(partnerCode)) {
      const partner = byCode.get(partnerCode)!
      claimed.add(entry.code)
      claimed.add(partner.code)
      offers.push(offerOf([entry, partner], entry.code))
      continue
    }
    // Deduction half whose main already claimed it, or a lone deduction half
    // whose main is missing from the chart: skip until the main walks past.
    const isDeductionHalf = chart.taxCodes.some(
      (other) => other.deductionCode === entry.code && byCode.has(other.code),
    )
    if (isDeductionHalf) continue
    claimed.add(entry.code)
    offers.push(offerOf([entry], entry.code))
  }

  return offers
}

function offerOf(entries: readonly ChartTaxCode[], key: string): TaxCodeOffer {
  const primary = entries[0]!
  return {
    key,
    codes: entries.map((entry) => entry.code),
    descriptions: entries.map((entry) => entry.description),
    rateBasisPoints: primary.rateBasisPoints,
    direction: primary.direction,
    pair: entries.length > 1,
    correctionOnly: entries.some((entry) => isCorrectionOrImportOnly(entry.code)),
    entries,
  }
}

/**
 * Offers whose codes the entity does not already have.
 *
 * A pair is offered only when **neither** half exists — inserting one half
 * alone would leave an unpaired deduction code.
 */
export function availableTaxCodeOffers(
  chart: Chart,
  existingCodes: ReadonlySet<string>,
): readonly TaxCodeOffer[] {
  return taxCodeOffersFromChart(chart).filter((offer) =>
    offer.codes.every((code) => !existingCodes.has(code)),
  )
}

/** Resolve a posted allowlist key to the chart rows that must be inserted. */
export function resolveTaxCodeOffer(chart: Chart, key: string): TaxCodeOffer | null {
  return taxCodeOffersFromChart(chart).find((offer) => offer.key === key) ?? null
}
