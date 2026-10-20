/**
 * Bank matching helpers for the redesign slice (#61 / #57).
 *
 * Pure functions over API shapes — no React, no fetches. The screen maps
 * signed bank amounts to Af/Bij, confidence to plain-Dutch labels, and
 * booking dates onto locked periods without inventing suggestion counts
 * (#68). Period names are real (`Q3 2026`, `september 2026`, `boekjaar 2025`);
 * there is no reopen operation, so copy never promises one.
 */

import { formatMinorUnits } from '@klopt/core/format'
import { periodLabel } from './period-label.js'

export { capitalizePeriodLabel, periodLabel, sentencePeriodLabel } from './period-label.js'

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
 * Why a bank line’s booking date sits in a closed period.
 *
 * Soft-closed periods stay bookable for roles with `ledger:post-closed`
 * (`isBookingBlocked`); hard-closed and year-closed always block.
 *
 * `sequence` is the neutral fallback when fiscal years were not loaded — never
 * invent a calendar month from January 1st.
 */
export interface PeriodLock {
  readonly fiscalYear: string
  readonly period: number
  readonly status: 'soft_closed' | 'hard_closed' | 'year_closed'
  readonly startsOn: string
  readonly endsOn: string
  /** Which plain-Dutch / English period label to use. */
  readonly kind: 'month' | 'quarter' | 'year' | 'sequence'
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
  const parsed = parseIsoDate(iso)
  if (parsed === null) return iso
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(parsed)
}

/** Full date with year for lock copy (`30 september 2026`). */
export function formatBankDayWithYear(iso: string, locale: string): string {
  const parsed = parseIsoDate(iso)
  if (parsed === null) return iso
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
}

function parseIsoDate(iso: string): Date | null {
  const [year, month, day] = iso.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return null
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return new Date(Date.UTC(year, month - 1, day))
}

/**
 * Named period for copy. Prefers the shared `periodLabel` helper (#73/#74)
 * whenever fiscal years are supplied; otherwise uses the lock’s own dates.
 */
function lockDetail(lock: PeriodLock): Record<string, string> {
  return {
    fiscalYear: lock.fiscalYear,
    period: lock.period > 0 ? String(lock.period) : '',
    startsOn: lock.startsOn,
    endsOn: lock.endsOn,
    yearStatus: lock.status === 'year_closed' ? 'closed' : 'open',
  }
}

export function formatPeriodLabel(
  lock: PeriodLock,
  locale: string,
  yearName: (year: string) => string,
  years?: readonly FiscalYearWithPeriods[] | null,
): string {
  if (years !== undefined) {
    return periodLabel(years, lockDetail(lock), locale)
  }
  if (lock.kind === 'year') {
    const year = lock.fiscalYear.trim()
    return year === '' ? periodLabel(null, null, locale) : yearName(year)
  }
  if (lock.kind === 'sequence') {
    return periodLabel(null, lockDetail(lock), locale)
  }
  if (lock.kind === 'quarter') {
    const month = Number(lock.startsOn.slice(5, 7))
    const quarter = Number.isFinite(month) && month >= 1 ? Math.floor((month - 1) / 3) + 1 : 1
    // Calendar year of the period start — not the fiscal-year code (July-start
    // FY 2026 period 9 is Jan–Mar 2027 → Q1 2027).
    const calendarYear = lock.startsOn.slice(0, 4)
    if (!/^\d{4}$/.test(calendarYear)) {
      return periodLabel(null, lockDetail(lock), locale)
    }
    return `Q${String(quarter)} ${calendarYear}`
  }
  const parsed = parseIsoDate(lock.startsOn)
  if (parsed === null) {
    return periodLabel(null, lockDetail(lock), locale)
  }
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
}

/** How many unmatched lines to show before the remaining label caps at "500+". */
export const MATCH_QUEUE_CAP = 500

/**
 * Remaining-queue copy: exact plural below and at the cap; "500+" only above it.
 * Pair with a fetch of `cap + 1` so a full page of `cap` lines does not look capped.
 */
export function remainingLabel(
  fetchedCount: number,
  capped: string,
  exact: (count: number) => string,
  cap: number = MATCH_QUEUE_CAP,
): string {
  return fetchedCount > cap ? capped : exact(fetchedCount)
}

/**
 * Find the closed period that contains `bookingDate`, or null when the date is
 * in an open period. Soft-closed is returned even when the actor may post —
 * the UI decides whether booking is blocked via `isBookingBlocked`.
 */
export function periodLockForDate(
  years: readonly FiscalYearWithPeriods[],
  bookingDate: string,
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

    if (period.status === 'hard_closed' || period.status === 'soft_closed') {
      return {
        fiscalYear: year.code,
        period: period.sequence,
        status: period.status,
        startsOn: period.startsOn,
        endsOn: period.endsOn,
        kind: lockKind(year, period),
      }
    }

    return null
  }

  return null
}

/** True when confirm/Enter must refuse this lock for this role. */
export function isBookingBlocked(lock: PeriodLock | null, canPostClosed: boolean): boolean {
  if (lock === null) return false
  if (lock.status === 'soft_closed') return !canPostClosed
  return true
}

/**
 * Prefer "quarter" when the whole calendar quarter sharing this period is
 * closed with the *same* lock kind (all hard or all soft). Mixed soft/hard
 * months stay `month` so copy does not overstate. Year locks are above.
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
  if (quarterPeriods.length !== 3) return 'month'
  const status = quarterPeriods[0]!.status
  if (status !== 'hard_closed' && status !== 'soft_closed') return 'month'
  if (!quarterPeriods.every((row) => row.status === status)) return 'month'
  return 'quarter'
}

/** Violation codes that mean "this booking date is locked". */
export function isPeriodLockViolation(code: string): boolean {
  return code === 'period_hard_closed' || code === 'period_soft_closed'
}

/**
 * Build a PeriodLock from a confirmMatch violation when the queue did not
 * already know the period was closed (race with a concurrent close).
 *
 * Labels go through `periodLabel` (shared with #74): never invent January,
 * never blank. Missing detail still returns a lock so the UI can say
 * "Deze periode…".
 */
export function periodLockFromViolation(
  years: readonly FiscalYearWithPeriods[],
  code: string,
  detail: Readonly<Record<string, string>> | undefined,
): PeriodLock {
  const fiscalYear = (detail?.['fiscalYear'] ?? detail?.['year'] ?? '').trim()
  const periodRaw = (detail?.['period'] ?? '').trim()
  const sequence = periodRaw === '' ? 0 : Number(periodRaw)
  const status: PeriodLock['status'] = code === 'period_soft_closed' ? 'soft_closed' : 'hard_closed'
  const detailStartsOn = (detail?.['startsOn'] ?? '').trim()
  const detailEndsOn = (detail?.['endsOn'] ?? '').trim()
  const yearStatus = (detail?.['yearStatus'] ?? '').trim()

  if (fiscalYear === '' || periodRaw === '' || !Number.isFinite(sequence)) {
    return {
      fiscalYear,
      period: Number.isFinite(sequence) ? sequence : 0,
      status,
      startsOn: detailStartsOn,
      endsOn: detailEndsOn,
      kind: detailStartsOn !== '' ? 'month' : 'sequence',
    }
  }

  const year = years.find((row) => row.code === fiscalYear)
  const period = year?.periods.find((row) => row.sequence === sequence)
  const resolvedStatus: PeriodLock['status'] =
    code === 'period_soft_closed'
      ? 'soft_closed'
      : year?.status === 'closed' || yearStatus === 'closed'
        ? 'year_closed'
        : 'hard_closed'

  if (period !== undefined && year !== undefined) {
    return {
      fiscalYear,
      period: sequence,
      status: resolvedStatus,
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      kind: resolvedStatus === 'year_closed' ? 'year' : lockKind(year, period),
    }
  }

  // Years empty / period unknown: prefer dates from the violation so labels
  // stay real (`oktober 2026`) even when GET /fiscal-years failed or was
  // skipped. Quarter still needs the years list.
  if (detailStartsOn !== '') {
    return {
      fiscalYear,
      period: sequence,
      status: resolvedStatus,
      startsOn: detailStartsOn,
      endsOn: detailEndsOn,
      kind: resolvedStatus === 'year_closed' ? 'year' : 'month',
    }
  }

  return {
    fiscalYear,
    period: sequence,
    status: resolvedStatus,
    startsOn: year?.startsOn ?? '',
    endsOn: year?.endsOn ?? '',
    kind: resolvedStatus === 'year_closed' ? 'year' : 'sequence',
  }
}

/** Sum of allocation amounts, or the line amount when there are none. */
export function suggestionBookedAmount(
  suggestion: {
    readonly allocations: readonly { readonly amount: string }[]
  },
  lineAmount: string,
): string {
  if (suggestion.allocations.length === 0) {
    return formatEuro(lineAmount)
  }
  let total = 0n
  for (const allocation of suggestion.allocations) {
    total += BigInt(allocation.amount)
  }
  return formatEuro(total)
}

/**
 * Label for a suggestion row: invoice numbers, or the learned account.
 * With Geavanceerd off, prefer the account name over a bare number.
 */
export function suggestionLabel(
  suggestion: {
    readonly allocations: readonly { readonly number: string }[]
    readonly accountNumber: string | null
    readonly reason: string
  },
  options?: {
    readonly preferAccountName?: boolean
    readonly accountName?: string | null
  },
): string {
  if (suggestion.allocations.length > 0) {
    return suggestion.allocations.map((item) => item.number).join(', ')
  }
  if (suggestion.accountNumber !== null && suggestion.accountNumber !== '') {
    if (options?.preferAccountName === true) {
      const name = options.accountName
      if (name !== null && name !== undefined && name !== '') return name
    }
    return suggestion.accountNumber
  }
  return suggestion.reason
}
