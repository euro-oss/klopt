import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for Moneybird btw picker primary / Andere codes (#71).
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=71 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-71.spec.ts
 *
 * Writes under docs/pr-screenshots/71/ in the real `_app` shell (nav + sheet).
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '71'
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
  await page.screenshot({ path: join(OUT, name), fullPage: true })
}

async function openFindings(page: Page, search: string): Promise<void> {
  await page.goto(`/lab/import-findings?${search}`)
  await expect(page.locator('[data-slot="import-findings"]')).toBeVisible({ timeout: 15_000 })
}

test('capture #71 btw picker PNGs (1440/390 × light/dark)', async ({ browser }) => {
  test.setTimeout(600_000)

  // Purchase 21%: VH21 preselected, Andere codes tonen visible (VH21-PRO hidden).
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of [
      ['desktop-1440', { width: 1440, height: 900 }],
      ['mobile-390', { width: 390, height: 844 }],
    ] as const) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `71 tax primary ${theme} ${label}`)
      await openFindings(page, 'source=moneybird&state=open')
      await page.getByTestId('lab-advanced').check()
      await openFindings(page, 'source=moneybird&state=open&sheet=tax')
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      await expect(sheet.getByRole('radio')).toHaveCount(1)
      await expect(sheet.getByRole('radio')).toHaveAttribute('aria-checked', 'true')
      await expect(sheet.locator('[data-slot="vat-show-other"]')).toContainText(
        'Andere codes tonen',
      )
      await expect(sheet.getByText('PRIV21')).toHaveCount(0)
      await setTheme(page, theme)
      await shoot(page, `btw-primary-${theme}-${label}.png`)
      await context.close()
    }
  }

  // Same sheet with Andere codes expanded — VH21-PRO visible, VH21 still checked.
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of [
      ['desktop-1440', { width: 1440, height: 900 }],
      ['mobile-390', { width: 390, height: 844 }],
    ] as const) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `71 tax other ${theme} ${label}`)
      await openFindings(page, 'source=moneybird&state=open')
      await page.getByTestId('lab-advanced').check()
      await openFindings(page, 'source=moneybird&state=open&sheet=tax')
      const sheet = page.getByRole('dialog')
      await sheet.locator('[data-slot="vat-show-other"] input[type="checkbox"]').check()
      await expect(sheet.getByRole('radio')).toHaveCount(2)
      await expect(sheet.getByText('VH21-PRO', { exact: true })).toBeVisible()
      await expect(sheet.locator('[data-slot="vat-show-other"]')).toContainText(
        'Andere codes verbergen',
      )
      await setTheme(page, theme)
      await shoot(page, `btw-other-${theme}-${label}.png`)
      await context.close()
    }
  }

  // Sales 0%: five codes, none preselected (Andere codes open because no primary).
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of [
      ['desktop-1440', { width: 1440, height: 900 }],
      ['mobile-390', { width: 390, height: 844 }],
    ] as const) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `71 tax zero ${theme} ${label}`)
      await openFindings(page, 'source=moneybird&state=open')
      await page.getByTestId('lab-advanced').check()
      await openFindings(page, 'source=moneybird&state=open&sheet=tax0')
      const sheet = page.getByRole('dialog')
      await expect(sheet.getByRole('radio')).toHaveCount(5)
      await expect(sheet.getByRole('radio', { checked: true })).toHaveCount(0)
      await expect(sheet.locator('[data-slot="vat-show-other"]')).toContainText(
        'Andere codes verbergen',
      )
      await expect(sheet.getByText('PRIV21')).toHaveCount(0)
      await setTheme(page, theme)
      await shoot(page, `btw-zero-${theme}-${label}.png`)
      await context.close()
    }
  }
})
