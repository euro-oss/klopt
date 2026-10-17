/**
 * Foreign-currency rates for Moneybird import (issue #42).
 *
 * Source of truth for the rate on a posting:
 * - `exchangeRate` / column `journal_lines.exchange_rate` — the numeric rate
 *   (functional per one unit of foreign currency), as a decimal string.
 * - `exchangeRateSource` / column `journal_lines.exchange_rate_source` — packed
 *   as `{source}:{date}` where source is `ecb` or `override` and date is the
 *   ISO day of the ECB reference (or the document day when overridden).
 *
 * Override is not a separate column: it is `exchangeRateSource` starting with
 * `override:`. The rate the user typed still lives in `exchangeRate`.
 *
 * ECB daily reference rates are cached (see `ecb_reference_rates`); looking up
 * an already-fetched date never needs the ECB to be reachable.
 */

import { multiplyByRate } from '../ledger/currency.js'
import type { JournalLineInput } from '../ledger/types.js'

export type FxRateSourceKind = 'ecb' | 'override'

export interface FxRateChoice {
  /** Decimal string, e.g. `0.9214` (EUR per 1 USD). */
  readonly rate: string
  readonly source: FxRateSourceKind
  /** ISO date `YYYY-MM-DD` of the ECB reference day used (or document day). */
  readonly date: string
}

export interface EcbRateRow {
  readonly currency: string
  readonly rateDate: string
  /** EUR per 1 unit of `currency`. */
  readonly rate: string
}

/** Pack source + date into the journal line's `exchangeRateSource` text. */
export function formatExchangeRateSource(choice: FxRateChoice): string {
  return `${choice.source}:${choice.date}`
}

/** Parse a stored `exchangeRateSource`, or null when the shape is unknown. */
export function parseExchangeRateSource(value: string | null | undefined): FxRateChoice | null {
  if (value === null || value === undefined || value === '') return null
  const match = /^(ecb|override):(\d{4}-\d{2}-\d{2})$/.exec(value)
  if (match === null) return null
  return {
    source: match[1] as FxRateSourceKind,
    date: match[2]!,
    rate: '', // rate lives on exchangeRate; caller fills it
  }
}

export function isValidFxRate(rate: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(rate)) return false
  const value = Number(rate)
  return Number.isFinite(value) && value > 0
}

/**
 * The ECB reference rate for `currency` on `documentDate`, or the nearest
 * earlier business day present in `rates`. ECB does not publish on weekends
 * and target holidays; walking backwards covers that.
 */
export function lookupEcbRate(
  rates: readonly EcbRateRow[],
  currency: string,
  documentDate: string,
): FxRateChoice | null {
  const code = currency.toUpperCase()
  if (code === 'EUR') {
    return { rate: '1', source: 'ecb', date: documentDate }
  }

  const forCurrency = rates
    .filter((row) => row.currency.toUpperCase() === code && row.rateDate <= documentDate)
    .sort((left, right) => right.rateDate.localeCompare(left.rateDate))

  const hit = forCurrency[0]
  if (hit === undefined) return null
  return { rate: hit.rate, source: 'ecb', date: hit.rateDate }
}

/** Apply a confirmed rate to every line of a planned entry (foreign amounts). */
export function applyFxToLines(
  lines: readonly JournalLineInput[],
  currency: string,
  choice: FxRateChoice,
): readonly JournalLineInput[] {
  const source = formatExchangeRateSource(choice)
  return lines.map((line) => ({
    ...line,
    currency,
    exchangeRate: choice.rate,
    exchangeRateSource: source,
  }))
}

/**
 * Preview amounts for the Koers step: foreign × rate = functional.
 *
 * Amounts are minor units in; euro strings out are the caller's job via
 * `formatMinorUnits`.
 */
export function convertMinorWithRate(foreignMinor: bigint, rate: string): bigint {
  return multiplyByRate(foreignMinor, rate)
}

export interface FxPreviewLine {
  readonly label: string
  readonly foreignMinor: bigint
  readonly functionalMinor: bigint
}

export function previewFxConversion(
  lines: readonly { readonly label: string; readonly amountMinor: bigint }[],
  rate: string,
): readonly FxPreviewLine[] {
  return lines.map((line) => ({
    label: line.label,
    foreignMinor: line.amountMinor,
    functionalMinor: convertMinorWithRate(line.amountMinor, rate),
  }))
}
