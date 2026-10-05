/**
 * Getting a value out of a Moneybird row without trusting it.
 *
 * Everything from the API arrives as `Record<string, unknown>`. Each read
 * states what it wants and what it does when it does not get it, and the
 * callers never index a row directly — the same discipline as Exact's reader.
 */

/** A row could not be turned into something we can use. */
export class MoneybirdReadError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message)
    this.name = 'MoneybirdReadError'
  }
}

function describe(value: unknown): string {
  if (value === undefined) return 'the field was not returned'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value.slice(0, 40))
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${typeof value} ${value.toString()}`
  }
  try {
    return `${typeof value} ${JSON.stringify(value).slice(0, 60)}`
  } catch {
    return typeof value
  }
}

/** A string, or null. Empty and whitespace-only both count as null. */
export function readString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field]
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function requireString(row: Record<string, unknown>, field: string): string {
  const value = readString(row, field)
  if (value === null) throw new MoneybirdReadError(`${field} is missing.`, field)
  return value
}

/** Moneybird ids are integers that JSON may send as a number or a string. */
export function readId(row: Record<string, unknown>, field: string): string | null {
  const value = row[field]
  if (typeof value === 'number') {
    return Number.isFinite(value) && Number.isInteger(value) ? String(value) : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  return null
}

export function requireId(row: Record<string, unknown>, field: string): string {
  const value = readId(row, field)
  if (value === null) {
    throw new MoneybirdReadError(`${field} is not an id: ${describe(row[field])}.`, field)
  }
  return value
}

export function readNumber(row: Record<string, unknown>, field: string): number | null {
  const value = row[field]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function readBoolean(row: Record<string, unknown>, field: string): boolean {
  const value = row[field]
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (value === 'true') return true
  if (value === 'false') return false
  return false
}

const ISO_DATE = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/

export function readDate(row: Record<string, unknown>, field: string): string | null {
  const value = row[field]
  if (typeof value !== 'string') return null
  const iso = ISO_DATE.exec(value)
  return iso?.[1] ?? null
}

export function requireDate(row: Record<string, unknown>, field: string): string {
  const value = readDate(row, field)
  if (value === null) throw new MoneybirdReadError(`${field} is not a date.`, field)
  return value
}

/**
 * How far `value * 100` may sit from a whole number and still be cents.
 *
 * Same tolerance as Exact: a decimal string `"121.00"` is exact, a float that
 * somehow arrived is still refused if it is not a cent amount.
 */
const CENT_TOLERANCE = 1e-4
const MAX_MINOR = 2e11

export function minorFromMoneybirdAmount(value: number, field = 'amount'): bigint {
  if (!Number.isFinite(value)) {
    throw new MoneybirdReadError(`${field} is not a finite number.`, field)
  }

  const scaled = value * 100
  if (Math.abs(scaled) > MAX_MINOR) {
    throw new MoneybirdReadError(
      `${field} is ${String(value)}, which is too large to convert without losing cents.`,
      field,
    )
  }

  const rounded = Math.round(scaled)
  if (Math.abs(scaled - rounded) > CENT_TOLERANCE) {
    throw new MoneybirdReadError(
      `${field} is ${String(value)}, which is not an amount in whole cents.`,
      field,
    )
  }

  return BigInt(rounded)
}

/** A Moneybird amount, which is usually a decimal string. */
export function readMinor(row: Record<string, unknown>, field: string): bigint | null {
  const value = row[field]
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return minorFromMoneybirdAmount(value, field)
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (!Number.isFinite(parsed)) {
      throw new MoneybirdReadError(`${field} is not a number: ${describe(value)}.`, field)
    }
    return minorFromMoneybirdAmount(parsed, field)
  }
  throw new MoneybirdReadError(`${field} is not a number: ${describe(value)}.`, field)
}

export function requireMinor(row: Record<string, unknown>, field: string): bigint {
  const value = readMinor(row, field)
  if (value === null) throw new MoneybirdReadError(`${field} is missing or not a number.`, field)
  return value
}

export function readArray(row: Record<string, unknown>, field: string): readonly unknown[] {
  const value = row[field]
  return Array.isArray(value) ? value : []
}
