/**
 * Shared period label for closed-period copy (#73 bank match, #74 guided invoice).
 *
 * Pure and self-contained: given fiscal years (possibly empty / undefined) and
 * server violation detail, returns a never-blank Dutch label with the year —
 * `oktober 2026`, `Q3 2026` (whole quarter only), `boekjaar 2026`, or the
 * neutral `Periode 9 van boekjaar 2026` when years failed to load. Missing
 * detail yields `deze periode`. #74 copies this file byte-for-byte.
 */

/** A fiscal year as `GET /fiscal-years` returns it (with period ranges). */
export interface PeriodLabelYear {
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

/** Violation `detail` keys used by `period_hard_closed` / `period_soft_closed`. */
export type PeriodLabelDetail = Readonly<Record<string, string>> | null | undefined

const MISSING = 'deze periode'

function parseIsoDate(iso: string): Date | null {
  const [year, month, day] = iso.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return null
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return new Date(Date.UTC(year, month - 1, day))
}

function readYear(detail: PeriodLabelDetail): string {
  if (detail == null) return ''
  const raw = detail['fiscalYear'] ?? detail['year'] ?? ''
  return raw.trim()
}

function readPeriod(detail: PeriodLabelDetail): number | null {
  if (detail == null) return null
  const raw = (detail['period'] ?? '').trim()
  if (raw === '') return null
  const sequence = Number(raw)
  return Number.isFinite(sequence) ? sequence : null
}

function isClosedStatus(status: string): boolean {
  return status === 'hard_closed' || status === 'soft_closed'
}

/** Prefer "quarter" when every month of that calendar quarter is closed. */
function quarterLabel(
  year: PeriodLabelYear,
  period: PeriodLabelYear['periods'][number],
): string | null {
  const month = Number(period.startsOn.slice(5, 7))
  if (!Number.isFinite(month) || month < 1) return null
  const quarter = Math.floor((month - 1) / 3) + 1
  const quarterStart = (quarter - 1) * 3 + 1
  const quarterMonths = [quarterStart, quarterStart + 1, quarterStart + 2]
  const quarterPeriods = year.periods.filter((row) => {
    const m = Number(row.startsOn.slice(5, 7))
    return quarterMonths.includes(m)
  })
  if (
    quarterPeriods.length !== 3 ||
    !quarterPeriods.every((row) => isClosedStatus(row.status))
  ) {
    return null
  }
  const code = year.code.trim()
  if (code === '') return null
  return `Q${String(quarter)} ${code}`
}

function monthLabel(startsOn: string, locale: string, fiscalYear: string): string | null {
  const parsed = parseIsoDate(startsOn)
  if (parsed === null) return null
  const formatted = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
  if (formatted.trim() === '') return null
  // Guard against a locale that drops the year.
  if (!/\d{4}/.test(formatted) && fiscalYear.trim() !== '') {
    return `${formatted} ${fiscalYear.trim()}`
  }
  return formatted
}

function sequenceLabel(period: number | null, fiscalYear: string): string {
  const year = fiscalYear.trim()
  if (period !== null && year !== '') {
    return `Periode ${String(period)} van boekjaar ${year}`
  }
  if (period !== null) return `Periode ${String(period)}`
  if (year !== '') return `boekjaar ${year}`
  return MISSING
}

/**
 * Real period name with year, or a safe generic — never blank, never `Q4 ` / `-`.
 *
 * @param years Fiscal years from the API; empty / undefined / null → sequence fallback.
 * @param detail Violation detail (`fiscalYear` / `year`, `period`); absent → `deze periode`.
 * @param locale Month names via `Intl` (default `nl-NL`).
 */
export function periodLabel(
  years: readonly PeriodLabelYear[] | null | undefined,
  detail: PeriodLabelDetail,
  locale: string = 'nl-NL',
): string {
  const fiscalYear = readYear(detail)
  const sequence = readPeriod(detail)

  if (fiscalYear === '' && sequence === null) return MISSING

  const list = years ?? []
  const year = fiscalYear === '' ? undefined : list.find((row) => row.code === fiscalYear)

  if (year !== undefined && year.status === 'closed') {
    const code = year.code.trim()
    return code === '' ? sequenceLabel(sequence, fiscalYear) : `boekjaar ${code}`
  }

  if (year !== undefined && sequence !== null) {
    const period = year.periods.find((row) => row.sequence === sequence)
    if (period !== undefined) {
      const asQuarter = quarterLabel(year, period)
      if (asQuarter !== null) return asQuarter
      const asMonth = monthLabel(period.startsOn, locale, fiscalYear)
      if (asMonth !== null) return asMonth
    }
  }

  // Years empty, period missing from the year, or incomplete detail.
  return sequenceLabel(sequence, fiscalYear)
}

/** Same as `periodLabel`, with the first character uppercased for sentence starts. */
export function sentencePeriodLabel(
  years: readonly PeriodLabelYear[] | null | undefined,
  detail: PeriodLabelDetail,
  locale: string = 'nl-NL',
): string {
  return capitalizePeriodLabel(periodLabel(years, detail, locale))
}

/** Uppercase the first character (`boekjaar 2026` → `Boekjaar 2026`). */
export function capitalizePeriodLabel(label: string): string {
  if (label.length === 0) return MISSING
  return label.charAt(0).toLocaleUpperCase() + label.slice(1)
}
