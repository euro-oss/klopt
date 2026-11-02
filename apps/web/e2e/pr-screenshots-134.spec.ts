import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for #134 — import wizard reskin.
 *
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=134 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-134.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '134'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function ready(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.goto('/setup')
  await page.getByLabel('Naam van de administratie').fill('Import Demo BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
  }, theme)
  await page.waitForTimeout(150)
}

async function shoot(
  page: Page,
  name: string,
  size: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(size)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(150)
  await page.screenshot({ path: join(OUT, name), fullPage: false })
}

test('empty source and XAF choice, light and dark, 1440 and 390', async ({ page }) => {
  await ready(page)
  await page.goto('/importeren')
  await expect(page.getByRole('radio', { name: /Moneybird/ })).toBeEnabled({ timeout: 15_000 })

  const sizes = [
    { label: 'desktop-1440', width: 1440, height: 1040 },
    { label: 'mobile-390', width: 390, height: 844 },
  ] as const

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    for (const size of sizes) {
      await shoot(page, `01-source-empty-${theme}-${size.label}.png`, size)
    }
  }

  await page.getByRole('radio', { name: /Een ander pakket/ }).click()
  await expect(page.getByRole('button', { name: 'Auditfile openen' })).toBeVisible()
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    for (const size of sizes) {
      await shoot(page, `02-source-xaf-${theme}-${size.label}.png`, size)
    }
  }
})
