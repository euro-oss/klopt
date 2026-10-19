import { rmSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, OUTBOX, signIn, uniqueEmail } from './support'

/**
 * Guided sales invoice (#45 / redesign slice 5).
 *
 * Eigenaar with Geavanceerd off walks Klant → Wat lever je → Controleren →
 * Versturen with the keyboard. No ledger account or VAT code is shown.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  rmSync(OUTBOX, { recursive: true, force: true })
})

async function administrationReady(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await hydrated(page)

  await page.goto('/settings')
  await page.getByLabel('Straat').fill('Lange Delft')
  await page.getByLabel('Huisnummer').fill('41')
  await page.getByLabel('Postcode').fill('4331 JC')
  await page.getByLabel('Plaats').fill('Middelburg')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('61234567')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL861234567B01')
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()
}

async function addCustomer(page: Page): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Hotel Zeezicht B.V.')
  await page.getByLabel('E-mail').fill('administratie@hotelzeezicht.nl')
  await page.getByLabel('Straat').fill('Boulevard de Ruyter')
  await page.getByLabel('Huisnr.').fill('2')
  await page.getByLabel('Postcode').fill('4381 KA')
  await page.getByLabel('Plaats').fill('Vlissingen')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Hotel Zeezicht B.V.' })).toBeVisible()
}

test('Eigenaar finishes the guided invoice with the keyboard and never sees a ledger code', async ({
  page,
}) => {
  await administrationReady(page, 'Guided Factuur BV')
  await addCustomer(page)

  await page.goto('/invoices/new')
  await expect(page.getByRole('heading', { name: 'Nieuwe factuur' })).toBeVisible()
  // No focus steal on load.
  await expect(page.locator('#cust-q')).not.toBeFocused()
  await expect(page.getByText('Stap 1 van 4')).toBeVisible()
  await expect(page.getByText(/journaalpost/i)).toHaveCount(0)
  await expect(page.getByText(/\bVH21\b|\b8000\b/)).toHaveCount(0)

  // Step 1 — arrows move the highlight; Enter advances from the primary CTA.
  await page.locator('#cust-q').focus()
  await page.keyboard.press('ArrowDown')
  await page.getByRole('option', { name: /Hotel Zeezicht/ }).click()
  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await expect(page.getByText('Stap 2 van 4')).toBeVisible()

  // Step 2 — lines. VAT shows as a rate label, not a code.
  await expect(page.getByLabel('Omschrijving regel 1')).toBeVisible()
  await page.getByLabel('Omschrijving regel 1').fill('Desembroden, week 41')
  await page.getByLabel('Aantal regel 1').fill('60')
  await page.getByLabel('Prijs regel 1').fill('4,20')
  const vatSelect = page.getByLabel('Btw regel 1')
  await expect(vatSelect).toBeVisible()
  await expect(vatSelect.locator('option:checked')).toContainText(/% btw|Geen btw/)
  await expect(page.getByText(/\bVH21\b|\bVH9\b|\bGEEN\b/)).toHaveCount(0)

  await page.getByRole('button', { name: /Verder/ }).click()
  await expect(page.getByText('Stap 3 van 4')).toBeVisible()
  await expect(page.getByText('Wat er gebeurt')).toBeVisible()
  await expect(page.getByText(/journaalpost/i)).toHaveCount(0)

  await page.getByRole('button', { name: /Verder/ }).click()
  await expect(page.getByText('Stap 4 van 4')).toBeVisible()
  await expect(page.getByRole('radio', { name: /Per e-mail/ })).toBeVisible()

  // Confirm + send via keyboard primary.
  await page.getByRole('button', { name: /^Versturen/ }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Factuur versturen?')).toBeVisible()
  await page.keyboard.press('Enter')

  // Issued number is real. Email may fail Peppol in bare e2e setups — both
  // "Verstuurd" and "Klaar voor" are honest success screens.
  await expect(
    page.getByRole('heading', { name: /Verstuurd naar Hotel Zeezicht|Klaar voor Hotel Zeezicht/ }),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Factuur \d{4}-\d+/)).toBeVisible()
  await expect(page.getByText(/journaalpost/i)).toHaveCount(0)
})

test('Escape steps back, and the empty state offers Relaties', async ({ page }) => {
  await administrationReady(page, 'Guided Leeg BV')

  await page.goto('/invoices/new')
  await expect(page.getByText('Nog geen klanten', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Naar Relaties' })).toBeVisible()

  await addCustomer(page)
  await page.goto('/invoices/new')
  await page.getByRole('option', { name: /Hotel Zeezicht/ }).click()
  await page.getByRole('button', { name: /Verder/ }).click()
  await expect(page.getByText('Stap 2 van 4')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Stap 1 van 4')).toBeVisible()
})

test('Geavanceerd on keeps the bookkeeper form', async ({ page }) => {
  await administrationReady(page, 'Guided Advanced BV')
  await addCustomer(page)

  await enableAdvancedMode(page)

  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await expect(page.getByLabel('Referentie klant')).toBeVisible()
  await expect(page.getByText('Stap 1 van 4')).toHaveCount(0)
})
