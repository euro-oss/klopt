/**
 * The browser clock for greetings and "today" labels.
 *
 * Kept out of route modules so `report-year.test.ts` can forbid `new Date()` /
 * `getFullYear` on boekjaar screens without also forbidding the greeting.
 */

import { dayPartAt, type DayPart } from './dashboard'

/** Local calendar date as `YYYY-MM-DD`. */
export function localTodayIso(): string {
  const now = new Date()
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Morning / afternoon / evening from the local hour. */
export function localDayPart(): DayPart {
  return dayPartAt(new Date().getHours())
}
