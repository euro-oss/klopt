import { defineConfig, devices } from '@playwright/test'
import { e2eWebServerEnv } from './e2e/server-env'
import { CONTACTS_OVERDUE_MIDNIGHT_NOW_ISO } from './e2e/support/contacts-overdue-fixture-dates.js'

const pointingAtExternalServer = process.env['KLOPT_E2E_BASE_URL'] !== undefined

/**
 * Contacts overdue styling with server + browser clocks at the Amsterdam/UTC
 * midnight boundary. Uses a fresh dev server with `KLOPT_E2E_NOW_ISO` and the
 * fake-clock preload so `todayInAmsterdam()` on the server matches the spec.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/contacts-open-overdue-styling-midnight.spec.ts',
  fullyParallel: false,
  forbidOnly: process.env['CI'] === 'true',
  retries: process.env['CI'] === 'true' ? 1 : 0,
  workers: 1,
  reporter: process.env['CI'] === 'true' ? 'line' : 'list',

  use: {
    baseURL: process.env['KLOPT_E2E_BASE_URL'] ?? 'http://localhost:3399',
    trace: 'retain-on-failure',
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

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
          env: {
            ...e2eWebServerEnv({
              ...process.env,
              KLOPT_E2E_NOW_ISO: CONTACTS_OVERDUE_MIDNIGHT_NOW_ISO,
            }),
            NODE_OPTIONS: '--import ./e2e/fake-server-clock.js',
            // UTC host, so the spec still catches a UTC-today regression on an Amsterdam-time machine.
            TZ: 'UTC',
          },
        },
      }),
})
