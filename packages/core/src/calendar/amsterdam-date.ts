/**
 * Calendar dates in Europe/Amsterdam for Dutch bookkeeping defaults.
 */

const AMSTERDAM = 'Europe/Amsterdam'

/** Today in Europe/Amsterdam as `YYYY-MM-DD`. */
export function todayInAmsterdam(now: Date = new Date()): string {
  return calendarDateInTimeZone(now, AMSTERDAM)
}

/** Calendar year in Europe/Amsterdam. */
export function calendarYearInAmsterdam(now: Date = new Date()): number {
  return Number(todayInAmsterdam(now).slice(0, 4))
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