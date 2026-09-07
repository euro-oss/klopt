import { violation, LedgerError } from '../errors.js'

/**
 * Declaration periods (spec 7.2: "monthly, quarterly, annual, configurable per
 * entity").
 *
 * Calendar periods, not fiscal ones. A boekjaar starting in July is perfectly
 * legal and changes nothing here: the Belastingdienst wants Q1 to be January
 * to March whatever the books do, so deriving the aangifte period from the
 * entity's fiscal year would file the wrong months. The two calendars are
 * genuinely independent and this is the one place that has to know it.
 */

export type VatPeriodKind = 'monthly' | 'quarterly' | 'annual'

export interface VatPeriod {
  readonly kind: VatPeriodKind
  /** `2026-Q1`, `2026-03`, `2026`. Stable enough to appear in a URL. */
  readonly code: string
  /** As an operator would say it: "1e kwartaal 2026". */
  readonly label: string
  readonly from: string
  readonly to: string
}

const MONTHS = [
  'januari',
  'februari',
  'maart',
  'april',
  'mei',
  'juni',
  'juli',
  'augustus',
  'september',
  'oktober',
  'november',
  'december',
]

const QUARTER_LABELS = ['1e kwartaal', '2e kwartaal', '3e kwartaal', '4e kwartaal']

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** The last day of a month, so February and the leap day stay the calendar's problem. */
function endOfMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0))
  return date.toISOString().slice(0, 10)
}

export function vatPeriodsIn(kind: VatPeriodKind, year: number): readonly VatPeriod[] {
  if (!Number.isInteger(year) || year < 1900 || year > 2999) {
    throw new LedgerError([violation('invalid_date', 'year', 'A declaration year is four digits.')])
  }

  if (kind === 'annual') {
    return [
      {
        kind,
        code: String(year),
        label: `Jaar ${String(year)}`,
        from: `${String(year)}-01-01`,
        to: `${String(year)}-12-31`,
      },
    ]
  }

  if (kind === 'monthly') {
    return MONTHS.map((name, index) => ({
      kind,
      code: `${String(year)}-${pad(index + 1)}`,
      label: `${name} ${String(year)}`,
      from: `${String(year)}-${pad(index + 1)}-01`,
      to: endOfMonth(year, index + 1),
    }))
  }

  return QUARTER_LABELS.map((label, index) => ({
    kind,
    code: `${String(year)}-Q${String(index + 1)}`,
    label: `${label} ${String(year)}`,
    from: `${String(year)}-${pad(index * 3 + 1)}-01`,
    to: endOfMonth(year, index * 3 + 3),
  }))
}

/** A period from its code, so a URL is enough to rebuild it. */
export function parseVatPeriodCode(code: string): VatPeriod {
  const annual = /^(\d{4})$/.exec(code)
  if (annual !== null) return vatPeriodsIn('annual', Number(annual[1]))[0]!

  const quarter = /^(\d{4})-Q([1-4])$/.exec(code)
  if (quarter !== null) {
    return vatPeriodsIn('quarterly', Number(quarter[1]))[Number(quarter[2]) - 1]!
  }

  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(code)
  if (month !== null) {
    return vatPeriodsIn('monthly', Number(month[1]))[Number(month[2]) - 1]!
  }

  throw new LedgerError([
    violation(
      'unknown_vat_period',
      'period',
      `${code} is not a declaration period. Use 2026, 2026-Q1 or 2026-03.`,
    ),
  ])
}

/**
 * The period a date falls in, for "which aangifte does this entry affect".
 */
export function vatPeriodFor(kind: VatPeriodKind, date: string): VatPeriod {
  const year = Number(date.slice(0, 4))
  const found = vatPeriodsIn(kind, year).find((period) => period.from <= date && period.to >= date)
  if (found === undefined) {
    throw new LedgerError([violation('invalid_date', 'date', `${date} is not a date.`)])
  }
  return found
}

/**
 * The deadline: the last day of the month after the period ends.
 *
 * Both filing and payment are due then, which is the rule for every period
 * length. Not a business-day calculation — the Belastingdienst's own deadline
 * is the calendar date, and a bookkeeper who wants a working-day reminder wants
 * it earlier anyway.
 */
export function vatDeadline(period: VatPeriod): string {
  const year = Number(period.to.slice(0, 4))
  const month = Number(period.to.slice(5, 7))
  return endOfMonth(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1)
}
