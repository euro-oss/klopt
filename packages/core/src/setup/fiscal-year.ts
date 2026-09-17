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

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * @param code   The book year's label, e.g. `2026`.
 * @param startMonth 1–12. The month the year opens in.
 */
export function planFiscalYear(code: string, startMonth: number): FiscalYearLayout {
  if (!/^\d{4}$/.test(code)) {
    throw new LedgerError([violation('invalid_date.fiscal_year_labelled', 'code')])
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
