import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import {
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  signIn,
  uniqueEmail,
} from './support'

/**
 * Desktop-light 1440 PNGs for #128 BillNew + PaymentBatch.
 *
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=128 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-128-billnew-paymentbatch.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '128'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(50)
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
  })
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[style]')) {
      const value = el.getAttribute('style')
      if (value === null) continue
      if (value === '' || /caret-color:\s*transparent/i.test(value)) {
        el.removeAttribute('style')
      }
    }
  })
}

async function openAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Screenshot Demo BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
}

test('BillNew + PaymentBatch desktop-light 1440 screenshots', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1040 })
  await openAdmin(page)

  // --- BillNew empty (no supplier) ---
  await page.goto('/purchases/new')
  await hydrated(page)
  await expect(page.getByRole('heading', { name: 'Nieuwe inkoopfactuur' })).toBeVisible()
  await shot(page, '01-billnew-empty-light-desktop-1440')

  // Supplier Eva's company
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-128')
  await page.getByLabel('Naam', { exact: true }).fill('Verzekering Fictief')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL009988776B01')
  await page.getByLabel('E-mail').fill('eva@example.nl')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Verzekering Fictief/ })).toBeVisible()

  // --- BillNew seeded ---
  await page.goto('/purchases/new')
  await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
  // Dates must fall inside the open book year or VH21 is cleared from the picker.
  await page.getByLabel('Hun nummer').fill('INK-DEMO-2026-0039')
  await page.getByLabel('Factuurdatum').fill('2026-02-10')
  await page.getByLabel('Vervaldatum').fill('2026-03-12')
  await page.getByLabel('Exclusief btw', { exact: true }).fill('200,33')
  await page.getByLabel('Btw', { exact: true }).fill('42,07')
  await page.getByLabel('Totaal', { exact: true }).fill('242,40')
  await page.getByLabel('Omschrijving regel 1').fill('Business insurance, Q1')
  await chooseOption(page, 'Grootboek regel 1', /^4400 /)
  await expect(page.getByLabel('Btw-code regel 1')).toHaveText(/^VH21/)
  await page.getByLabel('Excl. btw regel 1').fill('200,33')
  await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeVisible()
  await shot(page, '02-billnew-seeded-light-desktop-1440')

  // Bank for PaymentBatch
  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByLabel('Naam', { exact: true }).fill('Demo bankrekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()

  // --- PaymentBatch empty list ---
  await page.goto('/payments')
  await hydrated(page)
  await expect(page.getByRole('heading', { name: 'Kosten' })).toBeVisible()
  await shot(page, '03-paymentbatches-empty-light-desktop-1440')

  // --- PaymentBatch seeded (prepare) ---
  await page.getByRole('button', { name: 'Nieuwe batch' }).click()
  await page.getByLabel('Kenmerk').fill('BETAAL-128')
  await page.getByRole('button', { name: 'Aanmaken' }).click()
  await page.getByRole('button', { name: 'Betaling toevoegen' }).click()
  await page.getByLabel('Begunstigde').fill('Verzekering Fictief')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByLabel('Bedrag', { exact: true }).fill('242,40')
  await page.getByLabel('Eigen kenmerk').fill('INK-DEMO-2026-0039')
  await page.getByLabel('Omschrijving').fill('Business insurance')
  await page.getByRole('button', { name: 'Toevoegen' }).click()
  await expect(page.getByText('Verzekering Fictief')).toBeVisible()
  await shot(page, '04-paymentbatch-prepare-light-desktop-1440')
})
