import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'
import {
  startNullRateMoneybirdStandIn,
  startNullRateVatMismatchMoneybirdStandIn,
} from './support/moneybird-stand-in'

/**
 * Overzetten uit Moneybird, in a browser (issue #32).
 *
 * Connecting and preview talk to a loopback Moneybird stand-in (allowed base
 * URL), so null-% VAT mapping can be exercised on the real /moneybird page
 * without reaching moneybird.com (#90).
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Overzetten BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
}

test('the Moneybird screen offers only the step that can be done', async ({ page }) => {
  await anAdministration(page)

  await page.getByRole('link', { name: 'Moneybird' }).click()
  await expect(page.getByRole('heading', { name: 'Moneybird' })).toBeVisible()

  await expect(page.getByRole('heading', { name: '1. Verbinden' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '2. Welke administratie' })).toBeHidden()
  await expect(page.getByRole('heading', { name: '3. Proefimport' })).toBeHidden()
})

test('connecting is refused until there is a token', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/moneybird')

  await expect(page.getByLabel('Persoonlijk API-token')).toBeEnabled()
  const button = page.getByRole('button', { name: 'Verbinden met Moneybird' })
  await expect(button).toBeDisabled()

  await page.getByLabel('Persoonlijk API-token').fill('not-a-real-token')
  await expect(button).toBeEnabled()
})

test('i m reaches Moneybird under Importeren', async ({ page }) => {
  await anAdministration(page)

  // Same hydration wait as Exact: the sidebar only prints a chord once the
  // listener is live (#37).
  await expect(
    page
      .getByRole('link', { name: /^Dashboard/ })
      .locator('kbd')
      .first(),
  ).toBeVisible()
  await expect(page.getByRole('navigation').getByText('Importeren')).toBeVisible()
  await expect(
    page
      .getByRole('link', { name: /Moneybird/ })
      .locator('kbd')
      .first(),
  ).toContainText(/i/)

  await page.keyboard.press('i')
  await expect(page.getByText('I …')).toBeVisible()
  await page.keyboard.press('m')

  await expect(page.getByRole('heading', { name: 'Moneybird' })).toBeVisible()
})

test('null-% purchase and sales rates open the sheet from server candidates (#90)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.goto('/moneybird')
    await expect(page.getByRole('heading', { name: 'Moneybird' })).toBeVisible()

    await page.getByLabel('API-adres').fill(standIn.baseUrl)
    await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
    await page.getByRole('button', { name: 'Verbinden met Moneybird' }).click()
    await expect(page.getByRole('heading', { name: '2. Welke administratie' })).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: 'Administraties ophalen' }).click()
    await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'kies deze' }).first().click()
    await expect(page.getByRole('heading', { name: '3. Proefimport' })).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: 'Proefimport uitvoeren' }).click()
    await expect(
      page.locator('[data-slot="finding-card"][data-code="unmapped_tax_rate"]'),
    ).toHaveCount(2, { timeout: 60_000 })

    const purchase = page
      .locator('[data-slot="finding-card"][data-code="unmapped_tax_rate"]')
      .filter({ hasText: 'Geen btw' })
      .filter({ hasNotText: 'verkoop' })
      .first()
    await purchase.getByRole('button', { name: 'Btw-tarief koppelen' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('radio')).toHaveCount(1)
    await expect(sheet.getByRole('radio')).toContainText(/Inkoop zonder btw/)
    await expect(sheet.getByRole('radio')).toHaveAttribute('aria-checked', 'false')
    await expect(sheet.getByText('Voorstel')).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Opslaan' })).toBeDisabled()
    await sheet.getByRole('radio').click()
    await expect(sheet.getByRole('button', { name: 'Opslaan' })).toBeEnabled()
    await sheet.getByRole('button', { name: 'Opslaan' }).click()
    await expect(sheet).toHaveCount(0)

    // Re-read / preview refresh should drop the purchase blocker once mapped.
    await page.getByRole('button', { name: 'Proefimport uitvoeren' }).click()
    await expect(
      page.locator('[data-slot="finding-card"][data-code="unmapped_tax_rate"]'),
    ).toHaveCount(1, { timeout: 60_000 })

    const sales = page.locator('[data-slot="finding-card"][data-code="unmapped_tax_rate"]').first()
    await expect(sales).toContainText(/Geen btw verkoop/)
    // Re-preview can leave the guided panel open without the sheet — close, then open.
    if ((await sales.getByRole('button', { name: 'Sluiten' }).count()) > 0) {
      await sales.getByRole('button', { name: 'Sluiten' }).click()
    }
    await sales.getByRole('button', { name: 'Btw-tarief koppelen' }).click()
    const salesSheet = page.getByRole('dialog')
    await expect(salesSheet).toBeVisible()
    await expect(salesSheet.getByRole('radio').first()).toHaveAttribute('aria-checked', 'false')
    await expect(salesSheet.getByRole('button', { name: 'Opslaan' })).toBeDisabled()
    // Server candidates for 0% sales — never H21, nothing pre-selected.
    await expect(salesSheet.getByText('21% btw', { exact: true })).toHaveCount(0)
  } finally {
    await standIn.close()
  }
})

test('null-% purchase that still carries VAT shows the mismatch card and no VGEEN (#90)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const standIn = await startNullRateVatMismatchMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.goto('/moneybird')
    await expect(page.getByRole('heading', { name: 'Moneybird' })).toBeVisible()

    await page.getByLabel('API-adres').fill(standIn.baseUrl)
    await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
    await page.getByRole('button', { name: 'Verbinden met Moneybird' }).click()
    await expect(page.getByRole('heading', { name: '2. Welke administratie' })).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: 'Administraties ophalen' }).click()
    await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'kies deze' }).first().click()
    await expect(page.getByRole('heading', { name: '3. Proefimport' })).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: 'Proefimport uitvoeren' }).click()
    const mismatch = page.locator(
      '[data-slot="finding-card"][data-code="null_percentage_vat_mismatch"]',
    )
    await expect(mismatch).toBeVisible({ timeout: 60_000 })
    await expect(mismatch).toContainText(/document toont nog btw|document still shows VAT/i)
    await expect(mismatch).toContainText('LEV-VAT')

    // Plan suppresses unmapped_tax_rate for a VAT-mismatch rate — no VGEEN path.
    await expect(
      page
        .locator('[data-slot="finding-card"][data-code="unmapped_tax_rate"]')
        .filter({ hasText: 'Geen btw' }),
    ).toHaveCount(0)
    await expect(page.getByText('VGEEN', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/Inkoop zonder btw/)).toHaveCount(0)
  } finally {
    await standIn.close()
  }
})
