import { violation, LedgerError } from '../errors.js'

/**
 * Laying out a boekjaar.
 *
 * "Fiscal year need not equal calendar year" (spec 6.4), which is the only
 * interesting thing here: an entity whose year starts in July has period 1 in
 * July and period 12 ending the following June, and its 2026 book year is
 * labelled by the year it *starts* in. Getting that wrong puts entries in the
 * wrong year, which the period lookup then hides.
 *
 * Twelve periods. A thirteenth for year-end adjustments is common in larger
 * systems and is deliberately not here: it complicates every period comparison,
 * and an accountant's adjusting entries go in period 12 with a soft close in
 * front of them, which is what the soft-close permission is for.
 */

export interface FiscalYearPeriod {
  readonly sequence: number
  readonly startsOn: string
  readonly endsOn: string
}

export interface FiscalYearLayout {
  readonly code: string
  readonly startsOn: string
  readonly endsOn: string
  readonly periods: readonly FiscalYearPeriod[]
}

/** Inclusive bounds for a four-digit book-year label. */
export const FISCAL_YEAR_CODE_MIN = 1960
export const FISCAL_YEAR_CODE_MAX = 2100

export interface FiscalYearGateInput {
  readonly code: string
  readonly startsOn: string
  readonly endsOn: string
  readonly status: string
}

export type DocumentFiscalYearGate =
  | { readonly kind: 'ok' }
  | { readonly kind: 'blocked'; readonly code: string; readonly reason: 'missing' | 'closed' }

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function isFiscalYearCodeInRange(code: string): boolean {
  if (!/^\d{4}$/.test(code)) return false
  const year = Number(code)
  return year >= FISCAL_YEAR_CODE_MIN && year <= FISCAL_YEAR_CODE_MAX
}

/**
 * @param code   The book year's label, e.g. `2026`.
 * @param startMonth 1–12. The month the year opens in.
 */
export function planFiscalYear(code: string, startMonth: number): FiscalYearLayout {
  if (!/^\d{4}$/.test(code)) {
    throw new LedgerError([violation('invalid_date.fiscal_year_labelled', 'code')])
  }
  if (!isFiscalYearCodeInRange(code)) {
    throw new LedgerError([
      violation('invalid_date.fiscal_year_out_of_range', 'code', {
        min: String(FISCAL_YEAR_CODE_MIN),
        max: String(FISCAL_YEAR_CODE_MAX),
      }),
    ])
  }
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new LedgerError([violation('invalid_date.starting_month', 'startMonth')])
  }

  const year = Number(code)
  const periods: FiscalYearPeriod[] = []

  for (let index = 0; index < 12; index += 1) {
    const monthIndex = startMonth - 1 + index
    const start = new Date(Date.UTC(year, monthIndex, 1))
    // Day 0 of the next month is the last day of this one, so February and the
    // leap day are the calendar's problem rather than ours.
    const end = new Date(Date.UTC(year, monthIndex + 1, 0))

    periods.push({ sequence: index + 1, startsOn: iso(start), endsOn: iso(end) })
  }

  return {
    code,
    startsOn: periods[0]!.startsOn,
    endsOn: periods[11]!.endsOn,
    periods,
  }
}

/** The label of the year that follows, which a close needs to exist. */
export function nextFiscalYearCode(code: string): string {
  return String(Number(code) + 1)
}

/**
 * Which book-year label a document date falls in, from the starting month alone.
 *
 * Used when that year is not on the administration yet — the date still belongs
 * to a specific label, and that is the one that has to exist before anything
 * can post.
 */
export function fiscalYearCodeForDate(documentDate: string, startMonth: number): string | null {
  const day = documentDate.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null

  const calendarYear = Number(day.slice(0, 4))
  for (const candidate of [calendarYear, calendarYear - 1, calendarYear + 1]) {
    const code = String(candidate)
    if (!isFiscalYearCodeInRange(code)) continue
    const layout = planFiscalYear(code, startMonth)
    if (layout.startsOn <= day && day <= layout.endsOn) return layout.code
  }

  return null
}

/** The open book year with the earliest start date. */
export function earliestOpenFiscalYear(
  years: readonly FiscalYearGateInput[],
): FiscalYearGateInput | undefined {
  const open = years.filter((year) => year.status !== 'closed')
  if (open.length === 0) return undefined
  return open.reduce((earliest, year) => (year.startsOn < earliest.startsOn ? year : earliest))
}

/** The year before the earliest open one — the only prior year this screen offers. */
export function priorFiscalYearCodeToOpen(earliestOpenCode: string): string | null {
  const prior = String(Number(earliestOpenCode) - 1)
  return isFiscalYearCodeInRange(prior) ? prior : null
}

/**
 * Whether a document can post on its date yet.
 *
 * Missing book years and closed ones both block; only a missing year can be
 * opened from Boekjaren.
 */
export function assessDocumentFiscalYear(
  years: readonly FiscalYearGateInput[],
  documentDate: string,
  startMonth: number,
): DocumentFiscalYearGate {
  const day = documentDate.slice(0, 10)
  const containing = years.find((year) => year.startsOn <= day && day <= year.endsOn)
  if (containing !== undefined) {
    if (containing.status === 'closed') {
      return { kind: 'blocked', code: containing.code, reason: 'closed' }
    }
    return { kind: 'ok' }
  }

  const code = fiscalYearCodeForDate(day, startMonth)
  if (code === null) return { kind: 'ok' }

  if (years.some((year) => year.code === code)) {
    const row = years.find((year) => year.code === code)
    if (row !== undefined && row.status === 'closed') {
      return { kind: 'blocked', code, reason: 'closed' }
    }
    return { kind: 'ok' }
  }

  return { kind: 'blocked', code, reason: 'missing' }
}
