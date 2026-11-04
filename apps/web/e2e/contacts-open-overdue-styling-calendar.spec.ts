import { test } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { installWallClock } from './support/contacts-overdue-fixture-dates.js'
import { contactsOverdueFixtureDates } from './support/contacts-overdue-fixture-dates.js'
import {
  runCustomerOpenOverdueScenario,
  runSupplierOpenOverdueScenario,
} from './support/contacts-open-overdue-scenarios.js'
import { DATABASE_URL } from './support'

/**
 * Calendar proof for contacts open-overdue styling (#195).
 *
 * Not part of the default `pnpm test:e2e` run. Invoked once per date by
 * `e2e/scripts/contacts-calendar-proof.sh`, which sets `KLOPT_E2E_TODAY_ISO` so
 * the dev server reads a fixed “today” at process start and aligns `page.clock`.
 */

const asOf = process.env['KLOPT_E2E_TODAY_ISO']

test.use({ timezoneId: 'Europe/Amsterdam' })

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

test.describe('calendar proof', () => {
  test.skip(
    asOf === undefined || asOf === '',
    'requires KLOPT_E2E_TODAY_ISO from calendar proof script',
  )
  test.setTimeout(120_000)

  test('customer styling', async ({ page }) => {
    await installWallClock(page, asOf!)
    await runCustomerOpenOverdueScenario(page, contactsOverdueFixtureDates(asOf!))
  })

  test('supplier styling', async ({ page }) => {
    await installWallClock(page, asOf!)
    await runSupplierOpenOverdueScenario(page, contactsOverdueFixtureDates(asOf!))
  })
})
