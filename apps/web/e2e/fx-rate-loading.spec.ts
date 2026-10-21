import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Koers sheet loading UX: spinner copy, aria-busy, live region, slow hint,
 * editable rate while ECB lookup runs (lab fixtures — no live ECB).
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function ready(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Koers loading')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
}

test('Koers loading shows spinner text, aria-busy and a polite live region', async ({ page }) => {
  await ready(page)
  await page.goto('/lab/import-findings?source=moneybird&state=open&sheet=fxLoading')
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  const region = page.locator('[data-slot="fx-rate-region"]')
  await expect(region).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('button', { name: /Koers ophalen bij ECB/ })).toBeDisabled()
  await expect(page.locator('#fx-rate-input')).toBeEnabled()
  await expect(page.getByRole('status')).toContainText('Koers ophalen bij ECB')
})

test('Koers slow hint is present after the 3 s reveal while still loading', async ({ page }) => {
  await ready(page)
  // Lab `fxSlow` forces the hint for a11y/screenshot; the 3 s threshold is
  // covered by unit tests + CSS `fx-slow-hint-reveal`.
  await page.goto('/lab/import-findings?source=moneybird&state=open&sheet=fxSlow')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('[data-slot="fx-slow-hint"]')).toContainText(/zelf invullen/)
  await expect(page.locator('[data-slot="fx-rate-region"]')).toHaveAttribute('aria-busy', 'true')
})

test('typing during Koers loading keeps the field editable and does not freeze', async ({
  page,
}) => {
  await ready(page)
  await page.goto('/lab/import-findings?source=moneybird&state=open&sheet=fxLoading')
  const input = page.locator('#fx-rate-input')
  await expect(input).toBeEnabled()
  await input.fill('1,1490')
  await expect(input).toHaveValue('1,1490')
  await expect(page.getByRole('button', { name: /Koers ophalen bij ECB/ })).toBeDisabled()
})

test('Koers error state shows the je-voice conflict copy', async ({ page }) => {
  await ready(page)
  await page.goto('/lab/import-findings?source=moneybird&state=open&sheet=fxError')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('[data-slot="fx-error"]')).toContainText(/ECB-koers nu niet ophalen/)
  await expect(page.locator('#fx-rate-input')).toBeEnabled()
})
