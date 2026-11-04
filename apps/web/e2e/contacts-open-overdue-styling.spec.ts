import { test } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { todayInAmsterdam } from '../src/lib/amsterdam-date.js'
import { contactsOverdueFixtureDates } from './support/contacts-overdue-fixture-dates.js'
import {
  runCustomerOpenOverdueScenario,
  runSupplierOpenOverdueScenario,
} from './support/contacts-open-overdue-scenarios.js'
import { DATABASE_URL } from './support'

/**
 * #195 item 1 — open amount ink by default; red only when contact has overdue sales or purchase bills.
 *
 * Runs on the real calendar date (no `KLOPT_E2E_TODAY_ISO`). Fixture dates are
 * derived from `todayInAmsterdam()` so this passes on any day.
 */

test.use({ timezoneId: 'Europe/Amsterdam' })

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

test('not-yet-due open amount is ink on list and card; overdue is red; Niets open stays muted', async ({
  page,
}) => {
  await runCustomerOpenOverdueScenario(page, contactsOverdueFixtureDates(todayInAmsterdam()))
})

test('supplier open amount: not-yet-due bill is ink; overdue bill is red (purchase due dates)', async ({
  page,
}) => {
  await runSupplierOpenOverdueScenario(page, contactsOverdueFixtureDates(todayInAmsterdam()))
})
