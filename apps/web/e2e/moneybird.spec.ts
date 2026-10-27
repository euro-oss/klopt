import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'
import {
  startNullRateMoneybirdStandIn,
  startNullRateVatMismatchMoneybirdStandIn,
  type MoneybirdStandIn,
} from './support/moneybird-stand-in'

/**
 * Overzetten uit Moneybird, in a browser (issue #32 / #105).
 *
 * Connecting and preview talk to a loopback Moneybird stand-in (allowed base
 * URL), so null-% VAT mapping can be exercised on `/importeren` without
 * reaching moneybird.com (#90). Legacy `/moneybird` redirects here.
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

/** Volgende uses aria-disabled instead of the native disabled attribute. */
async function clickNext(page: Page): Promise<void> {
  const next = page.locator('button[data-focus="next"]')
  await expect
    .poll(
      async () => {
        const aria = await next.getAttribute('aria-disabled')
        return aria !== 'true' && aria !== ''
      },
      { timeout: 60_000 },
    )
    .toBe(true)
  await next.click()
}

/** Open Verbinden with Moneybird pre-selected via ?bron=. */
async function openVerbinden(page: Page): Promise<void> {
  await page.goto('/importeren?bron=moneybird')
  await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
  const moneybird = page.getByRole('radio', { name: /Moneybird/ })
  await expect(moneybird).toBeChecked()
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()
}

/** Reach Btw-codes with a stand-in connection and a chosen administration. */
async function reachBtwStep(page: Page, standIn: MoneybirdStandIn): Promise<void> {
  await openVerbinden(page)
  await page.locator('details').filter({ hasText: 'Geavanceerd' }).locator('summary').click()
  await page.getByLabel('API-adres').fill(standIn.baseUrl)
  await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
  await clickNext(page)
  await expect(
    page.getByRole('heading', { name: /Welke administratie en welke jaren/ }),
  ).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Administraties ophalen' }).click()
  await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
  await page.getByText('Voorbeeld BV').click()
  await expect(page.getByRole('checkbox', { name: '2026' })).toBeVisible({
    timeout: 60_000,
  })
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
    timeout: 30_000,
  })
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Welke btw-code/ })).toBeVisible({
    timeout: 30_000,
  })
}

test('the Moneybird screen offers only the step that can be done', async ({ page }) => {
  await anAdministration(page)

  await page.goto('/importeren?bron=moneybird')
  await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
  await expect(page.getByRole('banner').getByText('Moneybird', { exact: true })).toBeVisible()

  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: /Welke administratie en welke jaren/ }),
  ).toBeHidden()
  await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeHidden()
})

test('connecting is refused until there is a token', async ({ page }) => {
  await anAdministration(page)
  await openVerbinden(page)

  await expect(page.getByLabel('Persoonlijk API-token')).toBeEnabled()
  const button = page.locator('button[data-focus="next"]')
  await expect(button).toHaveAttribute('aria-disabled', 'true')

  await page.getByLabel('Persoonlijk API-token').fill('not-a-real-token')
  await expect(button).not.toHaveAttribute('aria-disabled', 'true')
})

test('i m reaches the import wizard under Importeren (#100)', async ({ page }) => {
  await anAdministration(page)

  // Same hydration wait as Exact: the sidebar only prints a chord once the
  // listener is live (#37). `i m` opens the wizard.
  await expect(
    page
      .getByRole('link', { name: /^Dashboard/ })
      .locator('kbd')
      .first(),
  ).toBeVisible()
  await expect(
    page.getByRole('navigation').getByRole('link', { name: /^Moneybird$/ }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('link', { name: /^Moneybird$/ })
      .locator('kbd')
      .first(),
  ).toContainText(/i/)

  await page.keyboard.press('i')
  await expect(page.getByText('I …')).toBeVisible()
  await page.keyboard.press('m')

  await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
})

test('null-% purchase and sales rates open the sheet from server candidates (#90)', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await anAdministration(page)
    await reachBtwStep(page, standIn)

    const purchase = page
      .locator('article')
      .filter({ hasText: 'Geen btw' })
      .filter({ hasNotText: 'verkoop' })
      .first()
    const sales = page.locator('article').filter({ hasText: 'Geen btw verkoop' }).first()
    await expect(purchase).toBeVisible({ timeout: 60_000 })
    await expect(sales).toBeVisible()
    await expect(page.locator('article').filter({ hasText: /^Geen btw/ })).toHaveCount(2)

    await purchase.getByRole('button', { name: /Btw-code kiezen|Andere kiezen/ }).click()
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

    // After mapping purchase, only the sales rate still needs a choice.
    await expect(
      purchase.getByRole('button', { name: /Btw-code kiezen|Andere kiezen|Bevestigen/ }),
    ).toHaveCount(0, { timeout: 60_000 })
    await expect(
      sales.getByRole('button', { name: /Btw-code kiezen|Andere kiezen|Bevestigen/ }),
    ).toHaveCount(1)

    await sales.getByRole('button', { name: /Btw-code kiezen|Andere kiezen/ }).click()
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
    await reachBtwStep(page, standIn)

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

test('/moneybird redirects to the import wizard with bron=moneybird (#105)', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/moneybird')
  await expect(page).toHaveURL(/\/importeren\?bron=moneybird/)
  await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
})

test('/moneybird/legacy bookmarks redirect to the wizard (#105)', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/moneybird/anything')
  await expect(page).toHaveURL(/\/importeren\?bron=moneybird/)
  await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
})
