import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Import findings redesign slice 4 (#61).
 *
 * Uses the dev-only lab with Moneybird / Exact fixtures — no live importer
 * tokens. Covers viewing, keyboard, category+btw sheet, FX ECB/Aangepast,
 * empty/loading/error, and Geavanceerd-gated numbers.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function openLab(page: Page, search: string = 'source=moneybird&state=open'): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Import Findings BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await page.goto(`/lab/import-findings?${search}`)
  await expect(page.locator('[data-slot="import-findings"]')).toBeVisible({ timeout: 15_000 })
}

test('Moneybird fixture shows honesty grid, blocking counts, and j/k', async ({ page }) => {
  await openLab(page)

  await expect(page.getByRole('navigation', { name: 'Hoofdnavigatie' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Moneybird' })).toBeVisible()
  await expect(page.getByText('Wat we gelezen hebben')).toBeVisible()
  await expect(page.getByText('Na te kijken')).toBeVisible()
  await expect(page.getByText(/3 blokkeren/)).toBeVisible()
  await expect(page.locator('[data-slot="honesty-grid"] [data-honesty="unread"]')).toBeVisible()

  const cards = page.locator('[data-slot="finding-card"]')
  await expect(cards.first()).toBeVisible()
  await cards.first().click()
  await expect(cards.first()).toHaveAttribute('data-selected', 'true')
  await cards.first().focus()
  await page.keyboard.press('j')
  await expect(cards.nth(1)).toHaveAttribute('aria-selected', 'true')
})

test('category sheet respects Geavanceerd off/on and ranked list', async ({ page }) => {
  await openLab(page)
  const advanced = page.getByTestId('lab-advanced')
  await expect(advanced).not.toBeChecked()

  const mapAccount = page.locator('[data-slot="finding-card"][data-code="unmapped_account"]')
  await mapAccount.getByRole('button', { name: 'Categorie kiezen' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('Beste match eerst')).toBeVisible()
  await expect(sheet.getByText('Beste match', { exact: true })).toBeVisible()
  // Numbers and RGS stay advanced-only (theme forbids font-mono; numbers use tabular-nums).
  await expect(sheet.locator('.tabular-nums', { hasText: '4510' })).toHaveCount(0)
  await expect(sheet.getByText(/RGS/)).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: /Gebruik 4510|Nieuwe categorie/ })).toBeVisible()
  // Ranked list shows more than a single row.
  await expect(sheet.getByRole('option')).toHaveCount(await sheet.getByRole('option').count())
  expect(await sheet.getByRole('option').count()).toBeGreaterThan(1)

  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await mapAccount.getByRole('button', { name: 'Sluiten' }).click()
  await expect(mapAccount).not.toHaveAttribute('data-fix-open', 'true')
  await advanced.check()
  await mapAccount.getByRole('button', { name: 'Categorie kiezen' }).click()
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('Voorgesteld op RGS')).toBeVisible()
  await expect(sheet.locator('.tabular-nums', { hasText: '4510' })).toBeVisible()
  await expect(sheet.getByText(/RGS /).first()).toBeVisible()

  await sheet.getByRole('button', { name: 'Opslaan' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByText(/Kantoorartikelen →/)).toBeVisible()
})

test('category search ↓ + ↵ commits the highlighted row, not the previous pick', async ({
  page,
}) => {
  await openLab(page)
  const mapAccount = page.locator('[data-slot="finding-card"][data-code="unmapped_account"]')
  await mapAccount.getByRole('button', { name: 'Categorie kiezen' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  const options = sheet.getByRole('option')
  expect(await options.count()).toBeGreaterThan(1)
  // First option is the RGS best match (Kantoorartikelen). ArrowDown → second.
  const secondLabel = ((await options.nth(1).innerText()).split('\n')[0] ?? '')
    .replace(/\s*Beste match\s*/g, '')
    .trim()

  await sheet.locator('#account-vat-query').focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(sheet).toBeHidden()
  await expect(page.getByText(`Kantoorartikelen → ${secondLabel}`)).toBeVisible()
  await expect(page.getByText('Kantoorartikelen → Kantoorartikelen')).toHaveCount(0)
})

test('btw sheet filters by direction and moves with arrow keys', async ({ page }) => {
  await openLab(page)
  await page.getByTestId('lab-advanced').check()
  await page.goto('/lab/import-findings?source=moneybird&state=open&sheet=tax')
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('VH21', { exact: true })).toBeVisible()
  await expect(sheet.getByRole('radio')).toHaveCount(1)
  await expect(sheet.getByRole('radio')).toHaveAttribute('aria-checked', 'true')

  await page.keyboard.press('Escape')
  await page.goto('/lab/import-findings?source=moneybird&state=open&sheet=tax0')
  const zeroSheet = page.getByRole('dialog')
  await expect(zeroSheet).toBeVisible()
  await expect(zeroSheet.getByRole('radio')).toHaveCount(5)
  await expect(zeroSheet.getByRole('radio', { checked: true })).toHaveCount(0)
  await zeroSheet.getByRole('radio').nth(0).focus()
  await page.keyboard.press('ArrowDown') // none → first (VERL)
  await expect(zeroSheet.getByRole('radio').nth(0)).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('ArrowDown') // → second (GEEN / Vrijgesteld)
  await expect(zeroSheet.getByRole('radio').nth(1)).toHaveAttribute('aria-checked', 'true')
  await expect(zeroSheet.getByRole('radio').nth(1)).toContainText(/Vrijgesteld|GEEN/)
})

test('btw sheet shows map-by-hand for an unsupported rate', async ({ page }) => {
  await openLab(page, 'source=moneybird&state=open&sheet=taxBad')
  await expect(page.getByRole('dialog')).toBeVisible()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('status')).toContainText(/vanzelf koppelen|zelf in de tabel/i)
  await expect(sheet.getByRole('radio')).toHaveCount(0)
  // No duplicate hint under the status box when options are empty (#69).
  await expect(sheet.getByText(/In Moneybird stond/)).toHaveCount(0)
})

test('btw sheet shows vatUnknown once for an empty rate', async ({ page }) => {
  await openLab(page, 'source=moneybird&state=open&sheet=taxEmpty')
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('status')).toContainText(/We weten niet welk tarief dit is/)
  await expect(sheet.getByRole('radio')).toHaveCount(0)
  // Status owns the copy; no second identical / short hint line.
  await expect(sheet.getByText(/We weten niet welk tarief dit is/)).toHaveCount(1)
  await expect(sheet.getByText(/In Moneybird stond geen tarief/)).toHaveCount(0)
})

test('FX sheet toggles ECB to Aangepast and back', async ({ page }) => {
  await openLab(page)

  await page
    .locator('[data-slot="finding-card"][data-code="unknown_currency"]')
    .getByRole('button', { name: 'Koers kiezen' })
    .click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText(/ECB ·/)).toBeVisible()

  await expect(sheet.getByText(/Euro per 1 Britse pond/)).toBeVisible()
  await expect(sheet.getByText(/1 EUR = 0,8672 GBP/)).toBeVisible()
  await expect(sheet.getByText(/GBP 1\.240,00 × 1,1531 = € 1\.429,84/)).toBeVisible()

  await sheet.locator('#fx-rate-input').fill('1,1490')
  await expect(sheet.getByText(/Aangepast ·/)).toBeVisible()
  await expect(sheet.getByText(/GBP 1\.240,00 × 1,1490 = € 1\.424,76/)).toBeVisible()
  await sheet.getByRole('button', { name: /Terug naar ECB/ }).click()
  await expect(sheet.getByText(/ECB ·/)).toBeVisible()

  await sheet.getByRole('button', { name: 'Koers gebruiken' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByText(/Koers /)).toBeVisible()
})

test('one-click preview then apply resolves a finding', async ({ page }) => {
  await openLab(page)

  const taxCard = page.locator('[data-slot="finding-card"][data-code="unmapped_tax_rate"]')
  await taxCard.scrollIntoViewIfNeeded()
  await taxCard.getByRole('button', { name: 'Gebruik 9% btw' }).click()
  await expect(taxCard).toHaveAttribute('data-fix-open', 'true')
  await expect(page.getByText('Dit verandert wat er geïmporteerd wordt')).toBeVisible()
  // First activation only opens the preview; confirm applies.
  await taxCard.getByRole('button', { name: 'Toepassen' }).click()
  await expect(page.getByText('Laag tarief → 9% btw')).toBeVisible()
})

test('empty, loading and error states', async ({ page }) => {
  await openLab(page, 'source=moneybird&state=empty')
  await expect(page.getByText('Alles is nagekeken')).toBeVisible()
  await expect(page.locator('[data-slot="import-findings-empty"]')).toBeVisible()

  await page.goto('/lab/import-findings?source=moneybird&state=loading')
  await expect(page.locator('[data-slot="import-findings-loading"]')).toBeVisible()

  await page.goto('/lab/import-findings?source=moneybird&state=error')
  await expect(page.locator('[data-slot="import-findings-error"]')).toBeVisible()
})

test('Exact fixture lists explain-only findings', async ({ page }) => {
  await openLab(page, 'source=exact&state=open')
  await expect(page.getByRole('heading', { level: 1, name: 'Exact Online' })).toBeVisible()
  await expect(page.locator('[data-slot="finding-card"]').first()).toBeVisible()
  await expect(page.getByText('Blokkeert import').first()).toBeVisible()
})
