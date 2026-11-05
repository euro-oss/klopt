import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import {
  advancedModeSwitch,
  DATABASE_URL,
  delayClientScripts,
  ensureConfiguredApiDelay,
  hydrated,
  isAdvancedModeSaveRequest,
  setAdvancedMode,
  signIn,
  uniqueEmail,
  waitForAdvancedModeSaveResponse,
} from './support'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

test.beforeEach(async ({ page }) => {
  await ensureConfiguredApiDelay(page)
})

async function signedInOwner(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Boekhouddetails BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
}

test('one boekhouddetails click toggles once and persists after reload', async ({ page }) => {
  await signedInOwner(page)
  await page.goto('/settings')
  const toggle = advancedModeSwitch(page)
  await expect(toggle).toBeEnabled()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  const persisted = waitForAdvancedModeSaveResponse(page)
  await toggle.click()
  const response = await persisted
  expect(response.status()).toBe(200)
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(toggle).not.toHaveAttribute('aria-busy', 'true')

  await page.reload()
  await hydrated(page)
  await expect(advancedModeSwitch(page)).toHaveAttribute('aria-checked', 'true')
})

test('double-click does not apply two toggles', async ({ page }) => {
  await signedInOwner(page)

  let posts = 0
  await page.route('**/*', async (route) => {
    const request = route.request()
    if (isAdvancedModeSaveRequest(request)) {
      posts += 1
    }
    await route.continue()
  })

  await page.goto('/settings')
  const toggle = advancedModeSwitch(page)
  await expect(toggle).toBeEnabled()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  const persisted = waitForAdvancedModeSaveResponse(page)
  await toggle.dblclick()
  const response = await persisted
  expect(response.status()).toBe(200)
  await expect(toggle).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  expect(posts).toBe(1)

  await page.reload()
  await hydrated(page)
  await expect(advancedModeSwitch(page)).toHaveAttribute('aria-checked', 'true')
})

test('delayed client bundle disables the switch until hydration', async ({ page }) => {
  await signedInOwner(page)
  await delayClientScripts(page, 1_500)
  await page.goto('/settings', { waitUntil: 'domcontentloaded' })
  const toggle = advancedModeSwitch(page)
  await expect(toggle).toBeDisabled()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(toggle).toBeEnabled({ timeout: 30_000 })
  await setAdvancedMode(page, true)
  await page.reload()
  await hydrated(page)
  await expect(advancedModeSwitch(page)).toHaveAttribute('aria-checked', 'true')
})
