/**
 * Calendar dates for Dutch bookkeeping screens.
 *
 * `toISOString().slice(0, 10)` is UTC. Between midnight and 02:00 in winter
 * (01:00 in summer) that is yesterday in Europe/Amsterdam — the same bug as
 * #79. Prefer this helper whenever the UI or a handler needs “today” as a
 * Dutch calendar day.
 */

const AMSTERDAM = 'Europe/Amsterdam'

/** Today in Europe/Amsterdam as `YYYY-MM-DD`. */
export function todayInAmsterdam(now: Date = new Date()): string {
  return calendarDateInTimeZone(now, AMSTERDAM)
}

/** Calendar date in a named IANA zone as `YYYY-MM-DD`. */
export function calendarDateInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Could not format a calendar date for ${timeZone}.`)
  }
  return `${year}-${month}-${day}`
}

/**
 * Add (or subtract) whole calendar days to an ISO `YYYY-MM-DD` date.
 * Uses UTC noon so DST does not shift the calendar day.
 */
export function addCalendarDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (match === null) return isoDate
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${String(y)}-${m}-${d}`
}
