/**
 * The browser clock for greetings and "today" labels.
 *
 * Kept out of route modules so `report-year.test.ts` can forbid `new Date()` /
 * `getFullYear` on boekjaar screens without also forbidding the greeting.
 */

import { dayPartAt, type DayPart } from './dashboard'

const ISO = /^\d{4}-\d{2}-\d{2}$/

function e2eTodayIsoFromProcessEnv(): string | null {
  if (process.env['KLOPT_E2E_LEGAL_TOGGLE'] !== '1') return null
  if (process.env['NODE_ENV'] === 'production') return null
  const fixed = process.env['KLOPT_E2E_TODAY_ISO']?.trim()
  if (fixed !== undefined && fixed !== '' && ISO.test(fixed)) return fixed
  return null
}

/** Local calendar date as `YYYY-MM-DD`. */
export function localTodayIso(): string {
  const e2eToday = e2eTodayIsoFromProcessEnv()
  if (e2eToday !== null) return e2eToday
  const now = new Date()
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Morning / afternoon / evening from the local hour. */
export function localDayPart(): DayPart {
  return dayPartAt(new Date().getHours())
}
