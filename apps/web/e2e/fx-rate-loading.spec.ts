import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Koers sheet loading UX: spinner copy, aria-busy on the ECB button, live
 * region (single announcement — no role=alert), slow hint, editable rate,
 * focus retention, retry keeping a typed rate (lab fixtures — no live ECB).
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

test('Koers loading announces via polite live region; no role=alert', async ({ page }) => {
  await ready(page)
  await page.goto('/lab/import-findings?source=moneybird&state=open&sheet=fxLoading')
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  const refresh = page.locator('[data-slot="fx-ecb-refresh"]')
  await expect(refresh).toHaveAttribute('aria-busy', 'true')
  await expect(refresh).toHaveAttribute('aria-disabled', 'true')
  // Native disabled would drop focus; aria-disabled must not set the attribute.
  await expect(refresh).not.toHaveAttribute('disabled')
  await expect(page.locator('#fx-rate-input')).toBeEnabled()
  await expect(page.getByRole('status')).toContainText('Koers ophalen bij ECB')
  await expect(sheet.locator('[role="alert"]')).toHaveCount(0)
  await expect(page.locator('[data-slot="fx-rate-region"]')).not.toHaveAttribute('aria-busy')
})

test('Koers slow hint is present after the 3 s reveal while still loading', async ({ page }) => {
  await ready(page)
  // Lab `fxSlow` forces the hint for a11y/screenshot; the 3 s threshold is
  // covered by unit tests + CSS `fx-slow-hint-reveal`.
  await page.goto('/lab/import-findings?source=moneybird&state=open&sheet=fxSlow')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('[data-slot="fx-slow-hint"]')).toContainText(/zelf invullen/)
  await expect(page.locator('[data-slot="fx-ecb-refresh"]')).toHaveAttribute('aria-busy', 'true')
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
  await expect(page.locator('[data-slot="fx-ecb-refresh"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

test('Koers error is warning-toned, single live announcement, no role=alert', async ({ page }) => {
  await ready(page)
  await page.goto('/lab/import-findings?source=moneybird&state=open&sheet=fxError')
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  const error = page.locator('[data-slot="fx-error"]')
  await expect(error).toContainText(/ECB-koers nu niet ophalen/)
  await expect(error).toHaveClass(/text-warning/)
  await expect(error).not.toHaveAttribute('role', 'alert')
  await expect(sheet.locator('[role="alert"]')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText(/ECB-koers nu niet ophalen/)
  await expect(page.locator('#fx-rate-input')).toBeEnabled()
})

test('Opnieuw ophalen keeps focus on the ECB button while busy', async ({ page }) => {
  await ready(page)
  await page.goto('/lab/import-findings?source=moneybird&state=open&sheet=fxError')
  const refresh = page.locator('[data-slot="fx-ecb-refresh"]')
  await refresh.focus()
  await expect(refresh).toBeFocused()
  await refresh.click()
  await expect(refresh).toHaveAttribute('aria-busy', 'true')
  await expect(refresh).toHaveAttribute('aria-disabled', 'true')
  await expect(refresh).toBeFocused()
  await expect(page.getByRole('status')).toContainText('Koers ophalen bij ECB')
})

test('Opnieuw ophalen keeps a typed rate', async ({ page }) => {
  await ready(page)
  await page.goto('/lab/import-findings?source=moneybird&state=open&sheet=fxError')
  const input = page.locator('#fx-rate-input')
  await input.fill('1,1490')
  await expect(input).toHaveValue('1,1490')
  await page.locator('[data-slot="fx-ecb-refresh"]').click()
  await expect(page.locator('[data-slot="fx-ecb-refresh"]')).toHaveAttribute('aria-busy', 'true')
  await expect(input).toHaveValue('1,1490')
  await expect(page.locator('[data-slot="fx-error"]')).toHaveCount(0)
})
