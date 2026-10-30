/**
 * Dashboard presentation helpers for the redesign werklijst (#61 slice 3).
 *
 * Pure functions over plain data so unit tests can name dates and amounts
 * without rendering a page. Copy and routing stay in the route / i18n.
 */

import type { WorkQueueKind } from './work-queue'

/**
 * Severity colour on a Home to-do tile.
 * Maps to export `.k-tile--danger|brand|info` (or neutral). Yellow is accent /
 * brand tile only — never a severity for "money has gone wrong".
 */
export type AttentionTone = 'error' | 'attention' | 'info' | 'neutral' | 'brand'

export const ATTENTION_TONE: Readonly<Record<WorkQueueKind, AttentionTone>> = {
  'import.blocking': 'error',
  'sales.overdue': 'error',
  'dunning.waiting': 'attention',
  'bank.unmatched': 'brand',
  'purchase.approve': 'info',
  'purchase.book': 'neutral',
  'vat.filing': 'neutral',
  'sales.draft': 'neutral',
  'inbox.waiting': 'neutral',
}

/** Width of a P&L glance bar as a percentage of the larger of income/expenses. */
export function glanceBarPercent(value: string, max: bigint): number {
  if (max <= 0n) return 0
  const amount = BigInt(value)
  if (amount <= 0n) return 0
  const pct = Number((amount * 1000n) / max) / 10
  return Math.min(100, Math.max(2, pct))
}

/**
 * First name for "Goedemorgen, Hidde" — the part before the first space.
 * Magic-link sign-in often leaves `name` empty; never fall back to the email
 * local-part (that wraps into four lines on phone). Caller shows a bare
 * greeting without a comma when this returns null.
 */
export function greetingName(fullName: string): string | null {
  const trimmed = fullName.trim()
  if (trimmed === '') return null
  const first = trimmed.split(/\s+/)[0]
  return first === undefined || first === '' ? trimmed : first
}

/** Capitalise the first letter — weekdays and full month names in the subline. */
export function capitalizeWord(value: string): string {
  if (value.length === 0) return value
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}

/** Calendar parts from an ISO `YYYY-MM-DD` (local calendar, not UTC). */
export function calendarParts(iso: string): {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly weekday: number
} {
  const [yearText, monthText, dayText] = iso.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(year, month - 1, day)
  return { year, month, day, weekday: date.getDay() }
}

export type DayPart = 'morning' | 'afternoon' | 'evening'

/** Local clock hour → day part for the greeting. */
export function dayPartAt(hour: number): DayPart {
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

/** Last four digits of an IBAN for "ING ··· 4821". */
export function ibanTail(iban: string): string {
  const compact = iban.replace(/\s+/g, '')
  return compact.length <= 4 ? compact : compact.slice(-4)
}

/**
 * A month label key suffix from a 1-based calendar month.
 * Used for chart axis and period rows (nl/en share the same keys).
 */
export function monthKey(month: number): `dash.month.${number}` {
  return `dash.month.${month}`
}

export interface MonthBar {
  /** 1–12 calendar month of the period start. */
  readonly month: number
  /** Period sequence in the boekjaar. */
  readonly sequence: number
  /** Income (revenue) in minor units. */
  readonly income: string
  /** Expenses in minor units. */
  readonly expenses: string
  /** True when today falls inside this period. */
  readonly partial: boolean
}

/**
 * Scale bar heights so the tallest month fills the chart.
 * Returns a percentage 0–100 for CSS height.
 */
export function barHeightPercent(value: string, max: bigint): number {
  if (max <= 0n) return 0
  const amount = BigInt(value)
  if (amount <= 0n) return 0
  const pct = Number((amount * 1000n) / max) / 10
  return Math.min(100, Math.max(2, pct))
}

export function maxMonthAmount(months: readonly MonthBar[]): bigint {
  let max = 0n
  for (const month of months) {
    const income = BigInt(month.income)
    const expenses = BigInt(month.expenses)
    if (income > max) max = income
    if (expenses > max) max = expenses
  }
  return max
}

/**
 * The six periods ending at the current one (or the latest that has started),
 * not the last six of the boekjaar — so November/December stay off the chart
 * in October.
 */
export function chartPeriodsThroughToday<T extends { readonly startsOn: string }>(
  periods: readonly T[],
  today: string,
  window = 6,
): T[] {
  const through = periods.filter((period) => period.startsOn <= today)
  return through.slice(Math.max(0, through.length - window))
}

export interface PeriodRow {
  readonly id: string
  readonly kind: 'month' | 'quarter' | 'year'
  /** Calendar month 1–12 for kind=month; quarter 1–4 for kind=quarter; year code for year. */
  readonly labelRef: string
  readonly status: 'open' | 'closed'
}

/**
 * Build the "Periodes" list: current open month, last closed quarter (if any),
 * previous closed year (if any). Quarters are derived from monthly periods
 * (no separate quarter-close API — see PR notes).
 */
export function buildPeriodRows(input: {
  readonly years: readonly {
    readonly code: string
    readonly status: string
    readonly periods: readonly {
      readonly sequence: number
      readonly startsOn: string
      readonly endsOn: string
      readonly status: string
    }[]
  }[]
  readonly activeCode: string
  readonly today: string
}): readonly PeriodRow[] {
  const rows: PeriodRow[] = []
  const active = input.years.find((year) => year.code === input.activeCode)
  if (active !== undefined) {
    const current =
      active.periods.find(
        (period) => period.startsOn <= input.today && input.today <= period.endsOn,
      ) ?? active.periods.find((period) => period.status === 'open')

    if (current !== undefined) {
      const month = Number(current.startsOn.slice(5, 7))
      rows.push({
        id: `month-${String(current.sequence)}`,
        kind: 'month',
        labelRef: String(month),
        status: current.status === 'open' ? 'open' : 'closed',
      })
    }

    // Calendar quarters from monthly periods (no separate quarter-close API).
    const sorted = [...active.periods].sort((a, b) => a.sequence - b.sequence)
    const closedQuarters: PeriodRow[] = []
    for (let q = 1; q <= 4; q += 1) {
      const slice = sorted.filter((period) => {
        const month = Number(period.startsOn.slice(5, 7))
        return Math.ceil(month / 3) === q
      })
      if (slice.length < 3) continue
      const allClosed = slice.every(
        (period) => period.status === 'soft_closed' || period.status === 'hard_closed',
      )
      const last = slice[slice.length - 1]
      if (last === undefined) continue
      const ended = last.endsOn < input.today
      if (allClosed && ended) {
        closedQuarters.push({
          id: `quarter-${String(q)}`,
          kind: 'quarter',
          labelRef: String(q),
          status: 'closed',
        })
      }
    }
    // Most recent closed quarter only, like the prototype.
    const latestQuarter = closedQuarters[closedQuarters.length - 1]
    if (latestQuarter !== undefined) rows.push(latestQuarter)
  }

  const previousClosed = [...input.years]
    .filter((year) => year.code !== input.activeCode && year.status === 'closed')
    .sort((a, b) => b.code.localeCompare(a.code))[0]
  if (previousClosed !== undefined) {
    rows.push({
      id: `year-${previousClosed.code}`,
      kind: 'year',
      labelRef: previousClosed.code,
      status: 'closed',
    })
  }

  return rows
}
