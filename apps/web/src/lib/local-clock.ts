/**
 * The browser clock for greetings and "today" labels.
 *
 * Kept out of route modules so `report-year.test.ts` can forbid `new Date()` /
 * `getFullYear` on boekjaar screens without also forbidding the greeting.
 */

import { dayPartAt, type DayPart } from './dashboard'
import { parseE2eAsOfHeader } from './e2e-as-of-header'
import { readE2eAsOfFromRequestScope } from './e2e-as-of-request'

function readE2eAsOfOverrideSafe(): string | null {
  if (typeof window !== 'undefined') return null
  if (typeof process === 'undefined') return null
  if (process.env['KLOPT_E2E_LEGAL_TOGGLE'] !== '1') return null
  if (process.env['NODE_ENV'] === 'production') return null

  const fromScope = readE2eAsOfFromRequestScope()
  if (fromScope !== null) return fromScope

  const parsed = parseE2eAsOfHeader(process.env['KLOPT_E2E_TODAY_ISO'])
  return parsed ?? null
}

/** Local calendar date as `YYYY-MM-DD`. */
export function localTodayIso(): string {
  const e2eToday = readE2eAsOfOverrideSafe()
  if (e2eToday !== null) return e2eToday
  const now = new Date()
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Morning / afternoon / evening from the local hour. */
export function localDayPart(): DayPart {
  return dayPartAt(new Date().getHours())
}
