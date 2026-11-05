import { defineConfig, devices } from '@playwright/test'
import base from './playwright.config.js'
import { e2eWebServerEnv } from './e2e/server-env'

/**
 * #200 fiscal-year booking gate e2e needs 15 January on the server and in the
 * browser. The main suite keeps the real calendar so contacts-overdue fixtures
 * stay honest; this config fixes `KLOPT_E2E_TODAY_ISO` at process start.
 */
export const FISCAL_YEAR_BOOKING_E2E_TODAY = '2026-01-15'

const pointingAtExternalServer = process.env['KLOPT_E2E_BASE_URL'] !== undefined

export default defineConfig({
  ...base,
  testMatch: ['**/fiscal-year-booking-200.spec.ts', '**/pr-screenshots-200.spec.ts'],
  testIgnore: [],
  ...(pointingAtExternalServer
    ? {}
    : {
        webServer: {
          command: 'vite dev --port 3399',
          stdout: 'pipe',
          stderr: 'pipe',
          port: 3399,
          reuseExistingServer: false,
          timeout: 120_000,
          env: e2eWebServerEnv({
            ...process.env,
            KLOPT_E2E_TODAY_ISO: FISCAL_YEAR_BOOKING_E2E_TODAY,
          }),
        },
      }),
  use: {
    ...base.use,
    timezoneId: 'Europe/Amsterdam',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
