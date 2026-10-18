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
 *
 * Lookup rule (PM #55): prefer the rate on the document date; otherwise the
 * nearest earlier ECB business day within {@link ECB_MAX_LOOKBACK_DAYS}
 * calendar days. Older cached rows must not be returned labelled ECB.
 *
 * Browser-safe: also exported as `@klopt/core/moneybird-fx`. Must stay free of
 * `node:crypto` / `node:fs` (only pulls ledger currency bigint maths).
 */

import { multiplyByRate } from '../ledger/currency.js'
import type { JournalLineInput } from '../ledger/types.js'

export type FxRateSourceKind = 'ecb' | 'override'

/** Max calendar days to walk back from the document date for an ECB rate. */
export const ECB_MAX_LOOKBACK_DAYS = 7

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
 * Normalize a user-typed rate (NL `0,9214` or `0.9214`) to a canonical decimal
 * string with `.`. Returns null when empty/invalid after normalization.
 */
export function normalizeFxRateInput(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, '').replace(',', '.')
  if (trimmed === '') return null
  if (!isValidFxRate(trimmed)) return null
  return trimmed
}

/** Days from `earlier` to `later` (ISO `YYYY-MM-DD`), both treated as UTC dates. */
export function calendarDaysBetween(earlier: string, later: string): number {
  const toUtc = (iso: string): number =>
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
  return Math.round((toUtc(later) - toUtc(earlier)) / 86_400_000)
}

/**
 * The ECB reference rate for `currency` on `documentDate`, or the nearest
 * earlier business day present in `rates` within {@link ECB_MAX_LOOKBACK_DAYS}.
 * Returns null when nothing qualifies — never a months-old cached rate.
 */
export function lookupEcbRate(
  rates: readonly EcbRateRow[],
  currency: string,
  documentDate: string,
  maxLookbackDays: number = ECB_MAX_LOOKBACK_DAYS,
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
  if (calendarDaysBetween(hit.rateDate, documentDate) > maxLookbackDays) return null
  return { rate: hit.rate, source: 'ecb', date: hit.rateDate }
}

/**
 * Whether `documentDate` is older than `days` calendar days before `today`
 * (ISO). Used to decide between the 90-day ECB feed and the full history file.
 */
export function isOlderThanDays(documentDate: string, days: number, today: string): boolean {
  return calendarDaysBetween(documentDate, today) > days
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
