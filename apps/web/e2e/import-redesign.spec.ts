import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * Import wizard v2 reskin (#134): six-step rail, XAF source, no horizontal
 * overflow at 390 in light and dark.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Import Redesign BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
  }, theme)
}

test('the source step shows six steps and does not overflow at 390', async ({ page }) => {
  await anAdministration(page)
  await page.setViewportSize({ width: 390, height: 844 })

  for (const theme of ['light', 'dark'] as const) {
    await page.goto('/importeren')
    await setTheme(page, theme)
    await expect(page.getByRole('heading', { name: 'Importeren', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
    await expect(page.getByText(/stap 1 van 6/)).toBeVisible()
    const moneybird = page.getByRole('radio', { name: /Moneybird/ })
    await expect(moneybird).toBeEnabled({ timeout: 15_000 })
    await expect(page.getByRole('radio', { name: /Een ander pakket/ })).toBeVisible()
    await expect(page.getByText(/meeste Nederlandse pakketten/)).toBeVisible()
    await expect(page.getByText(/elk Nederlands pakket|every Dutch package/i)).toHaveCount(0)

    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )
    expect(fits, `${theme} overflows at 390`).toBe(true)
  }
})

test('XAF records the wizard source and opens the audit-file dry run', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/importeren')
  const xaf = page.getByRole('radio', { name: /Een ander pakket/ })
  await expect(xaf).toBeEnabled({ timeout: 15_000 })
  await xaf.click()
  await expect(page).toHaveURL(/bron=xaf/)
  await expect(xaf).toBeChecked()
  await page.getByRole('button', { name: 'Auditfile openen' }).click()
  await expect(page).toHaveURL(/\/audit-file/)
  await expect(page.getByRole('heading', { name: 'Auditfile' })).toBeVisible()

  await page.goto('/importeren')
  await expect(page.getByRole('radio', { name: /Een ander pakket/ })).toBeChecked()
})
