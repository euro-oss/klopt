import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for the ECB Koers loading / error UX PR.
 *
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=<n> \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-fx-loading.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? 'pending'
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

test('capture Koers loading / slow hint / error PNGs (1440/390 × light/dark)', async ({
  browser,
}) => {
  test.setTimeout(600_000)
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of [
      ['desktop-1440', { width: 1440, height: 900 }],
      ['mobile-390', { width: 390, height: 844 }],
    ] as const) {
      for (const [sheet, slug] of [
        ['fxLoading', 'loading'],
        ['fxSlow', 'slow-hint'],
        ['fxError', 'error'],
      ] as const) {
        const context = await browser.newContext({ viewport: size })
        const page = await context.newPage()
        await ready(page, `FX ${slug} ${theme} ${label}`)
        await page.goto(`/lab/import-findings?source=moneybird&state=open&sheet=${sheet}`)
        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 })
        if (sheet === 'fxLoading' || sheet === 'fxSlow') {
          await expect(page.getByRole('button', { name: /Koers ophalen bij ECB/ })).toBeVisible()
        }
        if (sheet === 'fxSlow') {
          await expect(page.locator('[data-slot="fx-slow-hint"]')).toBeVisible()
        }
        if (sheet === 'fxError') {
          await expect(page.locator('[data-slot="fx-error"]')).toBeVisible()
        }
        await setTheme(page, theme)
        await shoot(page, `fx-${slug}-${theme}-${label}.png`)
        await context.close()
      }
    }
  }
})
