/**
 * Getting a value out of an Exact row without trusting it (spec 13).
 *
 * Everything from the API arrives as `Record<string, unknown>` — the JSON is
 * whatever Exact sent, and a column that was `Edm.String` yesterday is null on
 * the row where nobody filled it in. So each read states what it wants and what
 * it does when it does not get it, and the callers below never index a row
 * directly.
 */

/** A row could not be turned into something we can use. */
export class ExactReadError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message)
    this.name = 'ExactReadError'
  }
}

/** A string, or null. Empty and whitespace-only both count as null. */
export function readString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** A string that has to be there. */
export function requireString(row: Record<string, unknown>, field: string): string {
  const value = readString(row, field)
  if (value === null) throw new ExactReadError(`${field} is missing.`, field)
  return value
}

/** A number, or null. Exact sends `Edm.Int32` as a JSON number. */
export function readNumber(row: Record<string, unknown>, field: string): number | null {
  const value = row[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

export function requireNumber(row: Record<string, unknown>, field: string): number {
  const value = readNumber(row, field)
  if (value === null) throw new ExactReadError(`${field} is missing or not a number.`, field)
  return value
}

/**
 * A boolean. Missing counts as false.
 *
 * Exact also uses `Edm.Byte` as a boolean in places (`ExcludeVATListing`,
 * `UseCostcenter`), so a 0 or 1 is accepted too.
 */
export function readBoolean(row: Record<string, unknown>, field: string): boolean {
  const value = row[field]
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return false
}

/**
 * A date, as `YYYY-MM-DD`.
 *
 * Exact's `Edm.DateTime` comes back as `/Date(1234567890000)/` in the XML-ish
 * JSON of older endpoints and as `2026-03-31T00:00:00` in the newer ones. Both
 * are handled, because which one you get depends on the resource rather than on
 * anything a caller controls.
 *
 * The `/Date(…)/` form is milliseconds UTC; the ISO form has no zone and is a
 * calendar date in the division's own reckoning. Neither is shifted: an invoice
 * dated the 31st is dated the 31st, and applying a timezone to it is how a
 * booking moves into the previous quarter.
 */
const MS_DATE = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/
const ISO_DATE = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/

export function readDate(row: Record<string, unknown>, field: string): string | null {
  const value = row[field]
  if (typeof value !== 'string') return null

  const iso = ISO_DATE.exec(value)
  if (iso?.[1] !== undefined) return iso[1]

  const ms = MS_DATE.exec(value)
  if (ms?.[1] !== undefined) {
    const at = new Date(Number(ms[1]))
    if (Number.isNaN(at.getTime())) return null
    return at.toISOString().slice(0, 10)
  }

  return null
}

export function requireDate(row: Record<string, unknown>, field: string): string {
  const value = readDate(row, field)
  if (value === null) throw new ExactReadError(`${field} is not a date.`, field)
  return value
}

/**
 * A GUID, lower-cased and stripped of the braces Exact sometimes wraps it in.
 *
 * Normalised because these become the external ids an import matches on, and
 * `{ABC…}` and `abc…` being two different keys would import the same supplier
 * twice.
 */
const GUID = /^\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?$/i

export function readGuid(row: Record<string, unknown>, field: string): string | null {
  const raw = readString(row, field)
  if (raw === null) return null
  const match = GUID.exec(raw)
  return match?.[1] === undefined ? null : match[1].toLowerCase()
}

export function requireGuid(row: Record<string, unknown>, field: string): string {
  const value = readGuid(row, field)
  if (value === null) throw new ExactReadError(`${field} is not a GUID.`, field)
  return value
}

/**
 * The one that matters: an `Edm.Double` amount, as minor units.
 *
 * Exact types every amount as a double, so by the time `JSON.parse` is done the
 * value is already a float and no amount of care here recovers what the float
 * does not hold. What *can* be done is to convert once, at the edge, and refuse
 * anything that is not a two-decimal amount instead of rounding it away.
 *
 * `1234567.89` parses to `1234567.8899999999` and `× 100` gives
 * `123456788.99999999`, so rounding is required rather than optional. The
 * tolerance below is what separates "a float holding a cent amount" from "a
 * third of a euro", and a value outside it is a `problem` on the plan rather
 * than a silent 33.33.
 *
 * The safe range is the other half of it. Above 2^53 minor units a double
 * cannot distinguish neighbouring cents at all, so a value that large is
 * refused rather than converted to a number that looks precise.
 */
/**
 * How far `value * 100` may sit from a whole number and still be cents.
 *
 * A double holding a two-decimal amount is off by about `|value| * 2^-52`, so
 * after the multiply the error is around `|scaled| * 4.4e-16`. A tolerance of
 * 1e-4 therefore holds for any `scaled` below roughly 2.3e11 — and above that
 * the tolerance would start accepting values that are not cent amounts at all,
 * which is why the cap below is where it is rather than at
 * `Number.MAX_SAFE_INTEGER`.
 *
 * Two billion euro is the resulting ceiling on a single amount. An
 * administration with a larger one is not one this converter should guess at.
 */
const CENT_TOLERANCE = 1e-4
const MAX_MINOR = 2e11

export function minorFromExactAmount(value: number, field = 'amount'): bigint {
  if (!Number.isFinite(value)) {
    throw new ExactReadError(`${field} is not a finite number.`, field)
  }

  const scaled = value * 100
  if (Math.abs(scaled) > MAX_MINOR) {
    throw new ExactReadError(
      `${field} is ${String(value)}, which is too large to convert without losing cents.`,
      field,
    )
  }

  const rounded = Math.round(scaled)
  if (Math.abs(scaled - rounded) > CENT_TOLERANCE) {
    throw new ExactReadError(
      `${field} is ${String(value)}, which is not an amount in whole cents.`,
      field,
    )
  }

  return BigInt(rounded)
}

/** The same, from a row, with the field name carried into the error. */
export function readMinor(row: Record<string, unknown>, field: string): bigint | null {
  const value = readNumber(row, field)
  return value === null ? null : minorFromExactAmount(value, field)
}

export function requireMinor(row: Record<string, unknown>, field: string): bigint {
  const value = readMinor(row, field)
  if (value === null) throw new ExactReadError(`${field} is missing or not a number.`, field)
  return value
}
