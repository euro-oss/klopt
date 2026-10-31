import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for #107 Phase 2 Sales — Invoices / Reminders / PhoneSales /
 * PhoneInvoice / InvoicesDark.
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=<pr> \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-phase2-sales.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? 'phase2'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
    document.documentElement.dataset['theme'] = value
  }, theme)
}

async function shot(page: Page, name: string, options?: { fullPage?: boolean }): Promise<void> {
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    fullPage: options?.fullPage ?? false,
  })
}

async function setupEntity(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Demo Verkoop BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
}

async function seedSalesData(page: Page): Promise<void> {
  await page.goto('/settings')
  await page.getByLabel('Straat').fill('Demoweg')
  await page.getByLabel('Huisnummer').fill('10')
  await page.getByLabel('Postcode').fill('1000 BB')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('12345678')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL123456789B01')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()

  await page.getByRole('link', { name: /Relaties/ }).click()
  for (const [number, name, email] of [
    ['DEB-1001', 'Windvaan Workshops (demo)', 'windvaan@example.nl'],
    ['DEB-1002', 'Molenaar Media (demo)', 'molenaar@example.nl'],
  ] as const) {
    await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
    await page.getByLabel('Nummer', { exact: true }).fill(number)
    await page.getByLabel('Naam', { exact: true }).fill(name)
    await page.getByLabel('E-mail').fill(email)
    await page.getByLabel('Straat').fill('Voorbeeldstraat')
    await page.getByLabel('Huisnr.').fill('1')
    await page.getByLabel('Postcode').fill('1000 AA')
    await page.getByLabel('Plaats').fill('Amsterdam')
    await page.getByRole('button', { name: 'Opslaan' }).click()
    await expect(page.getByRole('cell', { name })).toBeVisible()
  }

  // Draft
  await page.goto('/invoices/new')
  await page.getByLabel('Omschrijving regel 1').fill('Demo concept')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Eenheid regel 1').fill('EA')
  await page.getByLabel('Prijs regel 1').fill('40,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page.getByRole('heading', { name: /Factuur Concept/ })).toBeVisible()

  // Issued open
  await page.goto('/invoices/new')
  await page.getByLabel('Omschrijving regel 1').fill('Demo open')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Eenheid regel 1').fill('EA')
  await page.getByLabel('Prijs regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('heading', { name: /Factuur \d{4}-/ })).toBeVisible()
}

test('01 empty Sales light/dark 1440 and 390', async ({ page }) => {
  await setupEntity(page)
  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1440, height: 1040 })
    await page.goto('/invoices')
    await hydrated(page)
    await setTheme(page, theme)
    await shot(page, `01-sales-empty-${theme}-desktop-1440`)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/invoices')
    await hydrated(page)
    await setTheme(page, theme)
    await shot(page, `01-sales-empty-${theme}-mobile-390`)
    await shot(page, `01-sales-empty-${theme}-mobile-390-full`, { fullPage: true })

    await page.setViewportSize({ width: 1440, height: 1040 })
    await page.goto('/dunning')
    await hydrated(page)
    await setTheme(page, theme)
    await shot(page, `01-reminders-empty-${theme}-desktop-1440`)
  }
})

test('02 seeded Sales + Reminders + phone invoice', async ({ page }) => {
  await setupEntity(page)
  await seedSalesData(page)

  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1440, height: 1040 })
    await page.goto('/invoices?segment=open')
    await hydrated(page)
    await setTheme(page, theme)
    await shot(page, `02-sales-data-${theme}-desktop-1440`)

    await page.goto('/invoices?segment=draft')
    await hydrated(page)
    await setTheme(page, theme)
    await shot(page, `02-sales-drafts-${theme}-desktop-1440`)

    await page.goto('/dunning')
    await hydrated(page)
    await setTheme(page, theme)
    await shot(page, `02-reminders-${theme}-desktop-1440`)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/invoices?segment=open')
    await hydrated(page)
    await setTheme(page, theme)
    await shot(page, `02-sales-data-${theme}-mobile-390`)
    await shot(page, `02-sales-data-${theme}-mobile-390-full`, { fullPage: true })

    await page.getByText('Windvaan Workshops (demo)').first().click()
    await hydrated(page)
    await setTheme(page, theme)
    await shot(page, `02-invoice-detail-${theme}-mobile-390`)
    await shot(page, `02-invoice-detail-${theme}-mobile-390-full`, { fullPage: true })
  }
})
