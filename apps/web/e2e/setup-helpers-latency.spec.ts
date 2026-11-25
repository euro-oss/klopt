import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import {
  chooseInAccountMenu,
  chooseOption,
  DATABASE_URL,
  ensureConfiguredApiDelay,
  e2eInteractionTimeout,
  enableAdvancedMode,
  hydrated,
  openAccountMenu,
  openEntitySwitcher,
  signIn,
  signOut,
  uniqueEmail,
  waitSetupHydrated,
  waitSignInHydrated,
} from './support'
import { openAdmin } from './support/contacts-open-overdue-scenarios'

/**
 * QA gate (#228 / #231): setup helpers survive 1500 ms non-GET latency when they
 * wait for hydration before interacting. Run together with
 * `import-advanced-hydration.spec.ts` for 20/20 at:
 *
 *   KLOPT_E2E_API_DELAY_MS=1500 KLOPT_E2E_API_DELAY_NON_GET_ONLY=1 \\
 *     bash e2e/scripts/latency-gate-proof.sh 20
 *
 * (35 tests per run: setup-helpers, import-advanced-hydration,
 * import-wizard-exact-resume, setup, account-menu, signin-setup-redesign.)
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

test.describe.configure({
  timeout: Number(process.env['KLOPT_E2E_API_DELAY_MS'] ?? 0) > 0 ? 180_000 : 60_000,
})

test.beforeEach(async ({ page }) => {
  await ensureConfiguredApiDelay(page)
})

async function freshAdmin(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await waitSignInHydrated(page)
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await waitSetupHydrated(page)
  await page.getByLabel('Naam', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible({ timeout: e2eInteractionTimeout() })
  await hydrated(page)
}

test('signIn completes under delayed OTP POST', async ({ page }) => {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible({
    timeout: e2eInteractionTimeout(),
  })
})

test('waitSetupHydrated sees an enabled setup submit', async ({ page }) => {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await waitSetupHydrated(page)
})

test('hydrated sees shell shortcut hints after setup', async ({ page }) => {
  await freshAdmin(page, 'Latency Hydration BV')
  await hydrated(page)
})

test('openAccountMenu opens the profile dialog', async ({ page }) => {
  await freshAdmin(page, 'Latency Menu BV')
  await openAccountMenu(page)
  await expect(page.getByRole('dialog', { name: 'Profiel' })).toBeVisible()
})

test('chooseInAccountMenu picks Licht and closes', async ({ page }) => {
  await freshAdmin(page, 'Latency Theme BV')
  await chooseInAccountMenu(page, 'Weergave', 'Licht')
  await expect(page.getByRole('button', { name: /Uitloggen|Sign out/ })).toBeHidden()
})

test('openEntitySwitcher exposes Administration combobox', async ({ page }) => {
  await freshAdmin(page, 'Latency Switcher BV')
  await openEntitySwitcher(page)
})

test('chooseOption can pick the active book year', async ({ page }) => {
  await freshAdmin(page, 'Latency Bookyear BV')
  const year = new Date().getFullYear()
  await chooseOption(page, 'Boekjaar', new RegExp(`^${year}`))
})

test('enableAdvancedMode persists under latency', async ({ page }) => {
  await freshAdmin(page, 'Latency Advanced BV')
  await enableAdvancedMode(page)
  await page.goto('/settings')
  await hydrated(page)
  await expect(
    page.getByRole('switch', { name: /Boekhouddetails|accounting details/i }),
  ).toHaveAttribute('aria-checked', 'true')
})

test('signOut returns to sign-in', async ({ page }) => {
  await freshAdmin(page, 'Latency Signout BV')
  await signOut(page)
  await expect(page).toHaveURL(/\/sign-in/)
  await waitSignInHydrated(page)
})

test('openAdmin helper finishes with advanced mode on', async ({ page }) => {
  await openAdmin(page)
  await page.goto('/settings')
  await hydrated(page)
  await expect(
    page.getByRole('switch', { name: /Boekhouddetails|accounting details/i }),
  ).toHaveAttribute('aria-checked', 'true')
})
