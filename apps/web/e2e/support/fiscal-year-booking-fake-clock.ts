import type { Page } from '@playwright/test'
import { wallClockInstantForIsoDate } from './contacts-overdue-fixture-dates.js'

/** Calendar day for #200 e2e (must match `KLOPT_E2E_TODAY_ISO` on the dev server). */
export const FISCAL_YEAR_BOOKING_E2E_TODAY = '2026-01-15'

export const FISCAL_YEAR_BOOKING_FAKE_CLOCK = `${FISCAL_YEAR_BOOKING_E2E_TODAY}T12:00:00.000+01:00`

/** Align Playwright’s clock with the server’s fixed e2e “today”. */
export async function installFiscalYearBookingFakeClock(page: Page): Promise<void> {
  const instant = wallClockInstantForIsoDate(FISCAL_YEAR_BOOKING_E2E_TODAY)
  await page.clock.install({ time: instant })
  await page.clock.setFixedTime(instant)
}
