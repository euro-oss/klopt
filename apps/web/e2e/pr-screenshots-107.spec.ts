import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for #107 Phase 0 — shell + token lab at 1440 / 390, light / dark.
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=107 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-107.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '107'
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
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(100)
  await page.screenshot({ path: join(OUT, name), fullPage: false })
}

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'mobile-390', width: 390, height: 844 },
] as const

test('shell and primitives lab screenshots', async ({ page }) => {
  await ready(page, 'Phase0 Shell BV')
  await enableAdvancedMode(page)

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await page.goto('/')
      await expect(
        page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
      ).toBeVisible()
      await shoot(page, `01-shell-home-${theme}-${vp.name}.png`)

      await page.goto('/reports/profit-and-loss')
      await expect(page.locator('[data-reports-tabs]')).toBeVisible()
      await shoot(page, `02-shell-reports-tabs-${theme}-${vp.name}.png`)

      await page.goto('/settings')
      await expect(page.getByRole('heading', { name: 'Overstappen naar Klopt' })).toBeVisible()
      await shoot(page, `03-settings-overstappen-${theme}-${vp.name}.png`)

      await page.goto('/lab/primitives')
      await expect(page.getByRole('heading', { name: 'Primitives lab' })).toBeVisible()
      await shoot(page, `04-primitives-lab-${theme}-${vp.name}.png`)
    }
  }
})
