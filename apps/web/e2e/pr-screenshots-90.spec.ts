import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for #90 — null-rate VAT sheet (VGEEN) + To review steps.
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=90 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-90.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '90'
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
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  // Prefer a hard navigation: the empty-state link can race hydration.
  await page.goto('/setup')
  await expect(page.getByLabel('Naam van de administratie')).toBeVisible()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
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

async function openFindings(page: Page, search: string): Promise<void> {
  await page.goto(`/lab/import-findings?${search}`)
  await expect(page.locator('[data-slot="import-findings"]')).toBeVisible({ timeout: 15_000 })
}

const VIEWPORTS = [
  ['desktop-1440', { width: 1440, height: 900 }],
  ['mobile-390', { width: 390, height: 844 }],
] as const

test('capture #90 null-rate VAT sheet + To review steps', async ({ browser }) => {
  test.setTimeout(600_000)

  // Resolve · VAT — Geen btw (—%) with VGEEN offered, nothing preselected.
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `90 null-rate ${theme} ${label}`)
      await openFindings(page, 'source=moneybird&state=open&sheet=taxEmpty')
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      await expect(sheet.getByText('Geen btw', { exact: true })).toBeVisible()
      await expect(sheet.getByRole('radio')).toContainText(/Inkoop zonder btw/)
      await expect(sheet.getByRole('radio')).toHaveAttribute('aria-checked', 'false')
      await expect(sheet.getByText(/Moneybird geeft geen percentage voor “Geen btw”/)).toBeVisible()
      await setTheme(page, theme)
      await shoot(page, `vat-null-rate-${theme}-${label}.png`)
      await context.close()
    }
  }

  // To review card — guided Geen btw finding with steps rendered (#90).
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `90 to-review ${theme} ${label}`)
      await openFindings(page, 'source=moneybird&state=open')
      const guided = page
        .locator('[data-slot="finding-card"][data-code="unmapped_tax_rate"]')
        .filter({ hasText: 'Geen btw' })
      await guided.scrollIntoViewIfNeeded()
      await guided.getByRole('button', { name: 'Btw-tarief koppelen' }).click()
      await expect(guided).toHaveAttribute('data-fix-open', 'true')
      await expect(guided.getByText('Btw-code kiezen')).toBeVisible()
      await expect(guided.getByText('Bewaren')).toBeVisible()
      await expect(guided.getByText(/Volg de stappen hierboven/)).toBeVisible()
      // Close the sheet so the card steps stay in frame.
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await guided.scrollIntoViewIfNeeded()
      await setTheme(page, theme)
      await shoot(page, `to-review-steps-${theme}-${label}.png`)
      await context.close()
    }
  }
})
