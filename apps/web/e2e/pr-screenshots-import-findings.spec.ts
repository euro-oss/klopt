import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for the import findings redesign PR.
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-import-findings.spec.ts
 *
 * Writes under docs/pr-screenshots/<pr>/ once the PR number is known; default 67.
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '67'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function ready(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

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
  await page.screenshot({ path: join(OUT, name), fullPage: false })
}

test('capture import findings PNGs (1440/390 × light/dark + empty)', async ({ browser }) => {
  test.setTimeout(180_000)
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of [
      ['desktop-1440', { width: 1440, height: 900 }],
      ['mobile-390', { width: 390, height: 844 }],
    ] as const) {
      {
        const context = await browser.newContext({ viewport: size })
        const page = await context.newPage()
        await ready(page, `Findings ${theme} ${label}`)
        await page.goto('/lab/import-findings?source=moneybird&state=open')
        await expect(page.locator('[data-slot="import-findings"]')).toBeVisible()
        await setTheme(page, theme)
        await shoot(page, `findings-${theme}-${label}.png`)
        await context.close()
      }
      {
        const context = await browser.newContext({ viewport: size })
        const page = await context.newPage()
        await ready(page, `Empty ${theme} ${label}`)
        await page.goto('/lab/import-findings?source=moneybird&state=empty')
        await expect(page.getByText('Alles is nagekeken')).toBeVisible()
        await setTheme(page, theme)
        await shoot(page, `findings-empty-${theme}-${label}.png`)
        await context.close()
      }
    }
  }

  // Account+VAT and FX sheets at desktop light (prototype companions).
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await ready(page, 'Sheets Desktop')
    await page.goto('/lab/import-findings?source=moneybird&state=open')
    await expect(page.locator('[data-slot="import-findings"]')).toBeVisible()
    await page
      .locator('[data-slot="finding-card"][data-code="unmapped_account"]')
      .getByRole('button', { name: 'Categorie kiezen' })
      .click()
    const accountSheet = page.getByRole('dialog')
    await expect(accountSheet).toBeVisible()
    await setTheme(page, 'light')
    await shoot(page, 'fix-account-vat-light-desktop-1440.png')
    await page.keyboard.press('Escape')
    await expect(accountSheet).toBeHidden()
    await page
      .locator('[data-slot="finding-card"][data-code="unmapped_account"]')
      .getByRole('button', { name: 'Sluiten' })
      .click()
    await page
      .locator('[data-slot="finding-card"][data-code="unknown_currency"]')
      .getByRole('button', { name: 'Koers kiezen' })
      .click()
    const fxSheet = page.getByRole('dialog')
    await expect(fxSheet).toBeVisible()
    await shoot(page, 'fix-fx-ecb-light-desktop-1440.png')
    await page.locator('#fx-rate-input').fill('1,1490')
    await expect(page.getByText(/Aangepast ·/)).toBeVisible()
    await shoot(page, 'fix-fx-override-light-desktop-1440.png')
    await context.close()
  }
})
