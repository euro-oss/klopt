/**
 * Which book year a screen is showing.
 *
 * Every report and the dashboard queue used `new Date().getFullYear()`, which
 * is the calendar year and not the boekjaar. Setup already offers a year that
 * starts in any month, so an administration running July–June was shown 2026
 * while its books were in the year labelled 2025 — silently, with no control
 * to correct it. A bookkeeping system that guesses the year wrong and does not
 * say so is worse than one that asks.
 *
 * So: the year is a choice, it is remembered, and it is resolved from the book
 * years the administration actually has. The rules are here, as functions over
 * plain data, because "which year is the current one" is exactly the kind of
 * thing that should be tested by naming dates rather than by rendering a page.
 */

/** Where the chosen year is remembered. Read on the server, set from the shell. */
export const REPORT_YEAR_COOKIE = 'klopt_report_year'

/**
 * A month rather than a year: long enough to survive a week of working on last
 * year's books, short enough that it does not strand somebody in a year they
 * chose once, last spring.
 */
export const REPORT_YEAR_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

/** A book year, as `GET /api/v1/fiscal-years` publishes it. */
export interface FiscalYearOption {
  readonly code: string
  readonly startsOn: string
  readonly endsOn: string
  readonly status: string
}

/** The year a screen is reading, and the date it reads it as of. */
export interface FiscalYearScope {
  readonly code: string
  readonly startsOn: string
  readonly endsOn: string
  /** Whether today falls inside it. */
  readonly isCurrent: boolean
  /**
   * The date open items are aged against: today while the year is running, and
   * the last day of the year once it is over. An ageing of a closed year as of
   * today would bucket every invoice in it as a year late.
   */
  readonly asOf: string
}

/** A four-digit label, which is what a book year is called. */
export function isFiscalYearCode(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{4}$/.test(value)
}

/**
 * The year today falls in.
 *
 * Falls back to the most recent year that has already started, and then to the
 * earliest known one, so that an administration whose years stop in 2024 shows
 * 2024 rather than nothing at all.
 */
export function currentFiscalYear(
  years: readonly FiscalYearOption[],
  today: string,
): FiscalYearOption | null {
  const containing = years.find((year) => year.startsOn <= today && today <= year.endsOn)
  if (containing !== undefined) return containing

  const started = years.filter((year) => year.startsOn <= today)
  if (started.length > 0) {
    return started.reduce((latest, year) => (year.startsOn > latest.startsOn ? year : latest))
  }

  const [earliest] = [...years].sort((left, right) => left.startsOn.localeCompare(right.startsOn))
  return earliest ?? null
}

/**
 * The year a screen should use: what was asked for, if the administration has
 * it, and otherwise the current one.
 *
 * A remembered choice that no longer exists — a different administration, a
 * year removed — resolves to the current year rather than to an empty report,
 * because "2019" in a cookie should not be able to make every figure zero.
 */
export function resolveFiscalYear(
  years: readonly FiscalYearOption[],
  requested: string | null,
  today: string,
): FiscalYearScope | null {
  const asked = requested === null ? undefined : years.find((year) => year.code === requested)
  const chosen = asked ?? currentFiscalYear(years, today)
  if (chosen === undefined || chosen === null) return null

  const isCurrent = chosen.startsOn <= today && today <= chosen.endsOn

  return {
    code: chosen.code,
    startsOn: chosen.startsOn,
    endsOn: chosen.endsOn,
    isCurrent,
    asOf: isCurrent ? today : today > chosen.endsOn ? chosen.endsOn : chosen.startsOn,
  }
}

/**
 * Whether a dated thing belongs to the year on screen.
 *
 * Takes a date or a timestamp, because the queue reads both: an invoice has a
 * date and an inbox arrival has a moment.
 */
export function withinFiscalYear(scope: FiscalYearScope, date: string | null): boolean {
  if (date === null || date === '') return false
  const day = date.slice(0, 10)
  return scope.startsOn <= day && day <= scope.endsOn
}
