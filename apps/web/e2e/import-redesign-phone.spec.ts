import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'
import { startPreValidFromMoneybirdStandIn } from './support/moneybird-stand-in'

/**
 * Import wizard phone layout (#134 QA): 390 light/dark past Source.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Import Phone BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
}

async function assertNoOverflow(page: Page, label: string): Promise<void> {
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
  expect(fits, label).toBe(true)
}

async function clickNext(page: Page): Promise<void> {
  await page.locator('button[data-focus="next"]').click()
}

test('390 connect step does not overflow at 390', async ({ page }) => {
  const standIn = await startPreValidFromMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/importeren')
    const moneybird = page.getByRole('radio', { name: /Moneybird/ })
    await expect(moneybird).toBeEnabled({ timeout: 15_000 })
    await moneybird.click()
    await clickNext(page)
    await page
      .locator('details')
      .filter({ hasText: /Geavanceerd|Boekhouddetails/ })
      .locator('summary')
      .click()
    await page.getByLabel('API-adres').fill(standIn.baseUrl)
    await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
    await assertNoOverflow(page, 'connect')
    await expect(page.getByLabel('Persoonlijk API-token')).toBeVisible()
    await expect(page.locator('button[data-focus="next"]')).toBeVisible()
  } finally {
    await standIn.close()
  }
})
