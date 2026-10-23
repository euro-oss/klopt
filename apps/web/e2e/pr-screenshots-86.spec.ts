import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for #86 — VGEEN label + server candidates (verlegd empty).
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=86 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-86.spec.ts
 *
 * Viewport shots only — sheet + dim backdrop fill the frame.
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '86'
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

test('capture #86 btw sheet PNGs (VGEEN + verlegd empty)', async ({ browser }) => {
  test.setTimeout(600_000)

  // Plain 0% purchase → Inkoop zonder btw (server candidate VGEEN).
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `86 purchase0 ${theme} ${label}`)
      await openFindings(page, 'source=moneybird&state=open&sheet=taxPurchase0')
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      await expect(sheet.getByRole('radio')).toContainText(/Inkoop zonder btw/)
      await setTheme(page, theme)
      await shoot(page, `btw-purchase0-${theme}-${label}.png`)
      await context.close()
    }
  }

  // 0% verlegd → no VGEEN, kan-nog-niet-verder (server candidates empty).
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `86 verlegd0 ${theme} ${label}`)
      await openFindings(page, 'source=moneybird&state=open&sheet=taxVerlegd0')
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      await expect(sheet.getByRole('radio')).toHaveCount(0)
      await expect(sheet.getByRole('status')).toContainText(
        /Klopt heeft nog geen btw-code voor dit tarief/,
      )
      await expect(sheet.locator('[data-slot="vat-jump-to-mapping"]')).toHaveCount(0)
      await setTheme(page, theme)
      await shoot(page, `btw-verlegd0-${theme}-${label}.png`)
      await context.close()
    }
  }
})
