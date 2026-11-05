/**
 * Local “today” for greetings and date labels (server and browser).
 *
 * On the server in non-production e2e, `KLOPT_E2E_TODAY_ISO` is read once at
 * module load (gated by `KLOPT_E2E_LEGAL_TOGGLE`); the browser and production
 * never use that override. Kept out of route modules so `report-year.test.ts`
 * can forbid `new Date()` / `getFullYear` on boekjaar screens without also
 * forbidding the greeting.
 */

import { todayInAmsterdam } from './amsterdam-date'
import { dayPartAt, type DayPart } from './dashboard'
import { parseCalendarIsoDate } from './calendar-iso-date'

/** Fixed at module load from `KLOPT_E2E_TODAY_ISO` (never written at runtime). */
function readE2eTodayAtProcessStart(): string | null {
  if (typeof window !== 'undefined') return null
  if (typeof process === 'undefined') return null
  if (process.env['KLOPT_E2E_LEGAL_TOGGLE'] !== '1') return null
  if (process.env['NODE_ENV'] === 'production') return null
  const parsed = parseCalendarIsoDate(process.env['KLOPT_E2E_TODAY_ISO'])
  return parsed ?? null
}

const e2eTodayAtProcessStart = readE2eTodayAtProcessStart()

/** Local calendar date as `YYYY-MM-DD`. */
export function localTodayIso(): string {
  if (e2eTodayAtProcessStart !== null) return e2eTodayAtProcessStart
  return todayInAmsterdam()
}

/** Morning / afternoon / evening from the local hour. */
export function localDayPart(): DayPart {
  // Match Playwright `wallClockInstantForIsoDate` (noon) when the e2e date is fixed.
  if (e2eTodayAtProcessStart !== null) return dayPartAt(12)
  return dayPartAt(new Date().getHours())
}
