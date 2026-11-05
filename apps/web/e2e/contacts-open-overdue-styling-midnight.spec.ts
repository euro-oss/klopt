import { test } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { todayInAmsterdam } from '../src/lib/amsterdam-date.js'
import {
  CONTACTS_OVERDUE_MIDNIGHT_NOW_ISO,
  contactsOverdueFixtureDates,
  installBrowserClockAtInstant,
} from './support/contacts-overdue-fixture-dates.js'
import {
  runCustomerOpenOverdueScenario,
  runSupplierOpenOverdueScenario,
} from './support/contacts-open-overdue-scenarios.js'
import { DATABASE_URL } from './support'

/**
 * Regression for #121: overdue styling when Amsterdam is already “tomorrow”
 * while UTC is still on the previous calendar date.
 *
 * The dev server is started with `KLOPT_E2E_NOW_ISO` and `e2e/fake-server-clock.js`
 * (see `playwright.contacts-midnight.config.ts`). The browser uses the same instant
 * via Playwright `page.clock`.
 */

const pinnedNow = new Date(CONTACTS_OVERDUE_MIDNIGHT_NOW_ISO)
const asOf = todayInAmsterdam(pinnedNow)

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

test.beforeEach(async ({ page }) => {
  await installBrowserClockAtInstant(page, pinnedNow)
})

test('not-yet-due open amount is ink on list and card; overdue is red; Niets open stays muted', async ({
  page,
}) => {
  await runCustomerOpenOverdueScenario(page, contactsOverdueFixtureDates(asOf))
})

test('supplier open amount: not-yet-due bill is ink; overdue bill is red (purchase due dates)', async ({
  page,
}) => {
  await runSupplierOpenOverdueScenario(page, contactsOverdueFixtureDates(asOf))
})
