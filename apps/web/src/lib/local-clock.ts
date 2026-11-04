/**
 * The browser clock for greetings and "today" labels.
 *
 * Kept out of route modules so `report-year.test.ts` can forbid `new Date()` /
 * `getFullYear` on boekjaar screens without also forbidding the greeting.
 */

import { dayPartAt, type DayPart } from './dashboard'
import { parseE2eAsOfHeader } from './e2e-as-of-header'

/** Fixed at module load from `KLOPT_E2E_TODAY_ISO` (never written at runtime). */
function readE2eTodayAtProcessStart(): string | null {
  if (typeof window !== 'undefined') return null
  if (typeof process === 'undefined') return null
  if (process.env['KLOPT_E2E_LEGAL_TOGGLE'] !== '1') return null
  if (process.env['NODE_ENV'] === 'production') return null
  const parsed = parseE2eAsOfHeader(process.env['KLOPT_E2E_TODAY_ISO'])
  return parsed ?? null
}

const e2eTodayAtProcessStart = readE2eTodayAtProcessStart()

/** Local calendar date as `YYYY-MM-DD`. */
export function localTodayIso(): string {
  if (e2eTodayAtProcessStart !== null) return e2eTodayAtProcessStart
  const now = new Date()
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Morning / afternoon / evening from the local hour. */
export function localDayPart(): DayPart {
  // Match Playwright `wallClockInstantForIsoDate` (noon) when the e2e date is fixed.
  if (e2eTodayAtProcessStart !== null) return dayPartAt(12)
  return dayPartAt(new Date().getHours())
}
