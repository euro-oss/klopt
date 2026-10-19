/**
 * Bank matching helpers for the redesign slice (#61 / #57).
 *
 * Pure functions over API shapes — no React, no fetches. The screen maps
 * signed bank amounts to Af/Bij, confidence to plain-Dutch labels, and
 * booking dates onto locked periods without inventing suggestion counts
 * (#68).
 */

import { formatMinorUnits } from '@klopt/core/format'

/** A fiscal year as `GET /fiscal-years` returns it (with period ranges). */
export interface FiscalYearWithPeriods {
  readonly code: string
  readonly startsOn: string
  readonly endsOn: string
  readonly status: string
  readonly periods: readonly {
    readonly sequence: number
    readonly startsOn: string
    readonly endsOn: string
    readonly status: string
  }[]
}

/**
 * Why a bank line cannot be booked into its booking date.
 *
 * Soft-closed periods stay bookable for roles with `ledger:post-closed`
 * (`canPostClosed`); hard-closed and year-closed always block.
 */
export interface PeriodLock {
  readonly fiscalYear: string
  readonly period: number
  readonly status: 'soft_closed' | 'hard_closed' | 'year_closed'
  readonly startsOn: string
  readonly endsOn: string
  /** Which plain-Dutch sentence names this lock. */
  readonly kind: 'month' | 'quarter' | 'year'
}

/** Suggestion confidence as the prototype prints it — never a fake %. */
export type ConfidenceTone = 'certain' | 'likely' | 'possible'

export function confidenceTone(confidence: number): ConfidenceTone {
  if (confidence >= 90) return 'certain'
  if (confidence >= 70) return 'likely'
  return 'possible'
}

/** Positive = Bij (in), negative = Af (out). Zero is Bij for display. */
export function isOutgoing(amountMinor: string | bigint): boolean {
  const value = typeof amountMinor === 'bigint' ? amountMinor : BigInt(amountMinor)
  return value < 0n
}

export function absoluteMinor(amountMinor: string | bigint): bigint {
  const value = typeof amountMinor === 'bigint' ? amountMinor : BigInt(amountMinor)
  return value < 0n ? -value : value
}

/**
 * `€` + NBSP + tabular Dutch figures — same convention as the dashboard (#67).
 * Sign is the caller's job (Af/Bij columns, or a leading − / +).
 */
export function formatEuro(amountMinor: string | bigint): string {
  return `€\u00a0${formatMinorUnits(absoluteMinor(amountMinor), {
    negative: 'minus',
    showZero: true,
  })}`
}

/** Last 4 of an IBAN for the page subtitle (`··· 4821`). */
export function ibanTail(iban: string): string {
  const compact = iban.replace(/\s+/g, '')
  return compact.length <= 4 ? compact : compact.slice(-4)
}

/**
 * Short day+month for the queue table (`16 okt`), locale-aware via `Intl`.
 * Falls back to the ISO date when parsing fails.
 */
export function formatBankDay(iso: string, locale: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return iso
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return iso
  const date = new Date(Date.UTC(year, month - 1, day))
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date)
}

/**
 * Find the locked period that contains `bookingDate`, or null when booking is
 * allowed.
 *
 * `canPostClosed` mirrors `mayPostToSoftClosedPeriod` on the server: soft-closed
 * is open for accountants/owners, closed for everyone else.
 */
export function periodLockForDate(
  years: readonly FiscalYearWithPeriods[],
  bookingDate: string,
  canPostClosed: boolean,
): PeriodLock | null {
  for (const year of years) {
    if (bookingDate < year.startsOn || bookingDate > year.endsOn) continue

    if (year.status === 'closed') {
      return {
        fiscalYear: year.code,
        period: year.periods[0]?.sequence ?? 0,
        status: 'year_closed',
        startsOn: year.startsOn,
        endsOn: year.endsOn,
        kind: 'year',
      }
    }

    const period = year.periods.find(
      (row) => row.startsOn <= bookingDate && bookingDate <= row.endsOn,
    )
    if (period === undefined) return null

    if (period.status === 'hard_closed') {
      return {
        fiscalYear: year.code,
        period: period.sequence,
        status: 'hard_closed',
        startsOn: period.startsOn,
        endsOn: period.endsOn,
        kind: lockKind(year, period),
      }
    }

    if (period.status === 'soft_closed' && !canPostClosed) {
      return {
        fiscalYear: year.code,
        period: period.sequence,
        status: 'soft_closed',
        startsOn: period.startsOn,
        endsOn: period.endsOn,
        kind: lockKind(year, period),
      }
    }

    return null
  }

  return null
}

/**
 * Prefer "quarter" when the whole calendar quarter sharing this period is
 * closed; otherwise name the month. Year locks are handled above.
 */
function lockKind(
  year: FiscalYearWithPeriods,
  period: FiscalYearWithPeriods['periods'][number],
): 'month' | 'quarter' {
  const month = Number(period.startsOn.slice(5, 7))
  if (!Number.isFinite(month) || month < 1) return 'month'
  const quarterStart = Math.floor((month - 1) / 3) * 3 + 1
  const quarterMonths = [quarterStart, quarterStart + 1, quarterStart + 2]
  const quarterPeriods = year.periods.filter((row) => {
    const m = Number(row.startsOn.slice(5, 7))
    return quarterMonths.includes(m)
  })
  if (
    quarterPeriods.length === 3 &&
    quarterPeriods.every((row) => row.status === 'hard_closed' || row.status === 'soft_closed')
  ) {
    return 'quarter'
  }
  return 'month'
}

/** Violation codes that mean "this booking date is locked". */
export function isPeriodLockViolation(code: string): boolean {
  return code === 'period_hard_closed' || code === 'period_soft_closed'
}

/**
 * Build a PeriodLock from a confirmMatch violation detail when the queue did
 * not already know the period was closed (race with a concurrent close).
 */
export function periodLockFromViolation(detail: Readonly<Record<string, string>> | undefined): {
  readonly fiscalYear: string
  readonly period: number
} | null {
  if (detail === undefined) return null
  const fiscalYear = detail['fiscalYear']
  const periodRaw = detail['period']
  if (fiscalYear === undefined || periodRaw === undefined) return null
  const period = Number(periodRaw)
  if (!Number.isFinite(period)) return null
  return { fiscalYear, period }
}

/** Label for a suggestion row: invoice numbers, or the learned account. */
export function suggestionLabel(suggestion: {
  readonly allocations: readonly { readonly number: string }[]
  readonly accountNumber: string | null
  readonly reason: string
}): string {
  if (suggestion.allocations.length > 0) {
    return suggestion.allocations.map((item) => item.number).join(', ')
  }
  if (suggestion.accountNumber !== null && suggestion.accountNumber !== '') {
    return suggestion.accountNumber
  }
  return suggestion.reason
}
