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
