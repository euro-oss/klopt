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
 */
export interface PeriodLock {
  readonly fiscalYear: string
  readonly period: number
  readonly status: 'soft_closed' | 'hard_closed' | 'year_closed'
  readonly startsOn: string
  readonly endsOn: string
  /** Which plain-Dutch / English period label to use. */
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
 * Named period for copy: `Q3 2026`, `september 2026`, or translated
 * `boekjaar 2025` / `fiscal year 2025`.
 */
export function formatPeriodLabel(
  lock: PeriodLock,
  locale: string,
  yearName: (year: string) => string,
): string {
  if (lock.kind === 'year') return yearName(lock.fiscalYear)
  if (lock.kind === 'quarter') {
    const month = Number(lock.startsOn.slice(5, 7))
    const quarter = Number.isFinite(month) && month >= 1 ? Math.floor((month - 1) / 3) + 1 : 1
    return `Q${String(quarter)} ${lock.fiscalYear}`
  }
  const parsed = parseIsoDate(lock.startsOn)
  if (parsed === null) return lock.fiscalYear
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
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
 * Build a PeriodLock from a confirmMatch violation when the queue did not
 * already know the period was closed (race with a concurrent close). Uses
 * fiscal year / period from the detail — never a hard-coded "this year".
 */
export function periodLockFromViolation(
  years: readonly FiscalYearWithPeriods[],
  code: string,
  detail: Readonly<Record<string, string>> | undefined,
): PeriodLock | null {
  if (detail === undefined) return null
  const fiscalYear = detail['fiscalYear']
  const periodRaw = detail['period']
  if (fiscalYear === undefined || periodRaw === undefined) return null
  const sequence = Number(periodRaw)
  if (!Number.isFinite(sequence)) return null

  const year = years.find((row) => row.code === fiscalYear)
  const period = year?.periods.find((row) => row.sequence === sequence)
  const status: PeriodLock['status'] =
    code === 'period_soft_closed'
      ? 'soft_closed'
      : year?.status === 'closed'
        ? 'year_closed'
        : 'hard_closed'

  if (period !== undefined && year !== undefined) {
    return {
      fiscalYear,
      period: sequence,
      status,
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      kind: status === 'year_closed' ? 'year' : lockKind(year, period),
    }
  }

  return {
    fiscalYear,
    period: sequence,
    status,
    startsOn: `${fiscalYear}-01-01`,
    endsOn: `${fiscalYear}-12-31`,
    kind: status === 'year_closed' ? 'year' : 'month',
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
