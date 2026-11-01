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
 * Public PNGs for Costs (#128) — light/dark × 1440/390, empty + seeded.
 *
 * Fixture data only: example.nl, Telecom Fictief, fake IBAN. No real addresses.
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=<pr> \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-costs.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? 'costs'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForFunction(
    (wantDark) => document.documentElement.classList.contains('dark') === wantDark,
    theme === 'dark',
  )
  await page.waitForTimeout(250)
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('input, textarea')) {
      el.style.caretColor = 'transparent'
    }
  })
  await page.screenshot({
    path: join(OUT, name),
    animations: 'disabled',
  })
}

async function openFirm(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Kosten Voorbeeld BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
}

async function seedBills(page: Page): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-DEMO-1')
  await page.getByLabel('Naam', { exact: true }).fill('Telecom Fictief')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL009988776B01')
  await page.getByLabel('E-mail').fill('facturen@example.nl')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Telecom Fictief' })).toBeVisible()

  for (const [number, book, approve] of [
    ['INK-DEMO-2025-0002', true, true],
    ['INK-DEMO-2025-0037', true, false],
  ] as const) {
    await page.goto('/purchases/new')
    await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
    await page.getByLabel('Factuurnummer leverancier').fill(number)
    // Stay inside the open boekjaar (2026) so the default VH21 code is not cleared.
    await page.getByLabel('Factuurdatum').fill('2026-02-10')
    await page.getByLabel('Vervaldatum').fill('2026-03-12')
    await page.getByLabel('Bedrag excl. btw', { exact: true }).fill('100,00')
    await page.getByLabel('Btw', { exact: true }).fill('21,00')
    await page.getByLabel('Totaal', { exact: true }).fill('121,00')
    await page.getByLabel('Omschrijving regel 1').fill('Software licentie demo')
    await chooseOption(page, 'Grootboek regel 1', /^4400 /)
    await chooseOption(page, 'Btw-code regel 1', /^VH21 /)
    await page.getByLabel('Excl. btw regel 1').fill('100,00')
    await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
    await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
    await page.getByRole('button', { name: 'Concept opslaan' }).click()
    await expect(page.getByRole('heading', { name: `Inkoopfactuur ${number}` })).toBeVisible({
      timeout: 15_000,
    })
    if (book) {
      await page.getByRole('button', { name: 'Boeken', exact: true }).click()
      await expect(page.getByRole('link', { name: /^boeking \d/ })).toBeVisible()
    }
    if (approve) {
      await page.getByRole('button', { name: 'Goedkeuren voor betaling' }).click()
      await expect(page.getByText('goedgekeurd voor betaling')).toBeVisible()
    }
  }
}

async function captureMatrix(
  page: Page,
  prefix: '01-costs-empty' | '02-costs-data',
  opts: { selectPreview: boolean },
): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)

    await page.setViewportSize({ width: 1440, height: 1040 })
    // hydrated() asserts the desktop rail kbd — only valid at ≥md.
    await hydrated(page)
    await expect(page.getByRole('heading', { name: 'Kosten' })).toBeVisible()
    if (opts.selectPreview) {
      await page.getByRole('heading', { name: 'Kosten' }).click()
      await page.keyboard.press('ArrowDown')
      await expect(page.getByRole('complementary', { name: 'Factuurvoorbeeld' })).toBeVisible()
    }
    await shoot(page, `${prefix}-${theme}-desktop-1440.png`)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('heading', { name: 'Kosten' })).toBeVisible()
    await expect(page.locator('[data-phone-tab-bar]')).toBeVisible()
    await expect(page.locator('[data-phone-tab-bar]').getByText('Bon')).toBeVisible()
    await shoot(page, `${prefix}-${theme}-mobile-390.png`)
  }
}

test('Costs screenshots — light/dark × 1440/390, empty + seeded', async ({ page }) => {
  test.setTimeout(240_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })

  await openFirm(page)
  await page.goto('/purchases')
  await hydrated(page)
  await expect(page.getByRole('heading', { name: 'Kosten' })).toBeVisible()
  await captureMatrix(page, '01-costs-empty', { selectPreview: false })

  // Forms and book/approve controls are desktop-oriented; leave phone before seeding.
  await page.setViewportSize({ width: 1440, height: 1040 })
  await setTheme(page, 'light')
  await seedBills(page)
  await page.goto('/purchases?segment=open')
  await hydrated(page)
  await expect(page.getByText('Telecom Fictief').first()).toBeVisible()
  await captureMatrix(page, '02-costs-data', { selectPreview: true })
})
