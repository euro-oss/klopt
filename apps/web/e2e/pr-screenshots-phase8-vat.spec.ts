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
 * Public PNGs for #132 Phase 8 VAT — Vat / Icp boards.
 *
 * Must-have: desktop light 1440. Bonus: dark + phone. Fixture data only
 * (example.nl, fake names).
 *
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=<pr> \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-phase8-vat.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '162'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function signInFresh(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Voorbeeld Administratie BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
    document.documentElement.dataset['theme'] = value
  }, theme)
}

async function shot(
  page: Page,
  name: string,
  size: { width: number; height: number },
  theme: 'light' | 'dark',
): Promise<void> {
  await page.setViewportSize(size)
  await setTheme(page, theme)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(200)
  await page.screenshot({
    path: join(OUT, `${name}-${theme}-${size.width === 1440 ? 'desktop-1440' : 'mobile-390'}.png`),
    fullPage: false,
  })
}

async function seedInvoice(page: Page): Promise<void> {
  await enableAdvancedMode(page)
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-9001')
  await page.getByLabel('Naam', { exact: true }).fill('Windvaan Workshops (demo)')
  await page.getByLabel('E-mail').fill('facturen@example.nl')
  await page.getByLabel('Straat').fill('Voorbeeldstraat')
  await page.getByLabel('Huisnr.').fill('1')
  await page.getByLabel('Postcode').fill('1000 AA')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Windvaan Workshops (demo)' })).toBeVisible()

  await page.goto('/settings')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL123456789B01')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()

  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await chooseOption(page, /^Klant$/, /^DEB-9001 /)
  await page.getByLabel('Factuurdatum').fill('2026-02-10')
  await page.getByLabel('Omschrijving regel 1').fill('Demo levering Q1')
  await page.getByLabel('Aantal regel 1').fill('10')
  await page.getByLabel('Prijs regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('link', { name: 'boeking', exact: true })).toBeVisible()
}

test('01 empty VAT desktop light (+ bonus variants)', async ({ page }) => {
  await signInFresh(page)
  await page.goto('/vat/2026-Q1')
  await hydrated(page)
  await expect(page.getByRole('heading', { name: 'BTW' })).toBeVisible()

  await shot(page, '01-vat-empty', { width: 1440, height: 1100 }, 'light')
  await shot(page, '01-vat-empty', { width: 1440, height: 1100 }, 'dark')
  await shot(page, '01-vat-empty', { width: 390, height: 844 }, 'light')
  await shot(page, '01-vat-empty', { width: 390, height: 844 }, 'dark')
})

test('02 seeded VAT + ICP desktop light (+ bonus variants)', async ({ page }) => {
  await signInFresh(page)
  await seedInvoice(page)
  await page.goto('/vat/2026-Q1')
  await hydrated(page)
  await expect(page.getByRole('table', { name: 'Rubrieken van de BTW-aangifte' })).toContainText(
    '1.000,00',
  )

  await shot(page, '02-vat-data', { width: 1440, height: 1100 }, 'light')
  await shot(page, '02-vat-data', { width: 1440, height: 1100 }, 'dark')
  await shot(page, '02-vat-data', { width: 390, height: 844 }, 'light')
  await shot(page, '02-vat-data', { width: 390, height: 844 }, 'dark')

  // Back to desktop before ICP — phone hides the sidebar kbd that hydrated() waits on.
  await page.setViewportSize({ width: 1440, height: 1100 })
  await setTheme(page, 'light')
  await page.goto('/vat/icp/2026-Q1')
  await hydrated(page)
  await expect(page.getByRole('heading', { name: 'ICP-opgaaf' })).toBeVisible()
  await shot(page, '02-icp-empty', { width: 1440, height: 1040 }, 'light')
  await shot(page, '02-icp-empty', { width: 1440, height: 1040 }, 'dark')
})
