import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for Moneybird btw picker (#71) — real nl-mkb chart via lab.
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=71 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-71.spec.ts
 *
 * Viewport shots only — sheet + dim backdrop fill the frame.
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

test('capture #71 btw picker PNGs (simple + one advanced set)', async ({ browser }) => {
  test.setTimeout(600_000)

  // Simple — purchase 21%: VH21 preselected, Andere tarieven tonen.
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `71 tax primary ${theme} ${label}`)
      await openFindings(page, 'source=moneybird&state=open&sheet=tax')
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      await expect(sheet.getByRole('radio')).toHaveCount(1)
      await expect(sheet.locator('[data-slot="vat-show-other"]')).toContainText(
        'Andere tarieven tonen',
      )
      await setTheme(page, theme)
      await shoot(page, `btw-primary-${theme}-${label}.png`)
      await context.close()
    }
  }

  // Simple — other expanded (VERL-ONTV / ICV21 / INV23).
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `71 tax other ${theme} ${label}`)
      await openFindings(page, 'source=moneybird&state=open&sheet=tax')
      const sheet = page.getByRole('dialog')
      await sheet.locator('[data-slot="vat-show-other"]').click()
      await expect(sheet.getByRole('radio')).toHaveCount(4)
      await expect(sheet.getByText('Btw verlegd naar jou')).toBeVisible()
      await expect(sheet.getByText('21% btw over inkoop uit de EU')).toBeVisible()
      await expect(sheet.locator('[data-slot="vat-show-other"]')).toContainText('Minder tonen')
      await setTheme(page, theme)
      await shoot(page, `btw-other-${theme}-${label}.png`)
      await context.close()
    }
  }

  // Simple — sales 0%: five options, no disclosure.
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `71 tax zero ${theme} ${label}`)
      await openFindings(page, 'source=moneybird&state=open&sheet=tax0')
      const sheet = page.getByRole('dialog')
      await expect(sheet.getByRole('radio')).toHaveCount(5)
      await expect(sheet.locator('[data-slot="vat-show-other"]')).toHaveCount(0)
      await expect(sheet.getByText('Vrijgesteld van btw')).toBeVisible()
      await setTheme(page, theme)
      await shoot(page, `btw-zero-${theme}-${label}.png`)
      await context.close()
    }
  }

  // One Geavanceerd-on set: other expanded with raw codes.
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `71 tax advanced ${theme} ${label}`)
      await openFindings(page, 'source=moneybird&state=open')
      await page.getByTestId('lab-advanced').check()
      await openFindings(page, 'source=moneybird&state=open&sheet=tax')
      const sheet = page.getByRole('dialog')
      const toggle = sheet.locator('[data-slot="vat-show-other"]')
      await expect(toggle).toContainText('Andere codes tonen')
      await toggle.click()
      await expect(sheet.getByText('VERL-ONTV', { exact: true })).toBeVisible()
      await expect(toggle).toContainText('Andere codes verbergen')
      await setTheme(page, theme)
      await shoot(page, `btw-advanced-other-${theme}-${label}.png`)
      await context.close()
    }
  }

  // 422 inline error on the lab mapping table (rollback + violation).
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `71 tax 422 ${theme} ${label}`)
      await openFindings(page, 'source=moneybird&state=open&sheet=taxMapFail')
      const panel = page.locator('[data-slot="lab-tax-map-fail"]')
      await expect(panel).toBeVisible()
      await panel.locator('input').fill('VH21')
      await panel.getByRole('button', { name: 'Mapping bewaren' }).click()
      await expect(panel.locator('[data-slot="tax-mapping-violation"]')).toContainText(
        /past niet bij VH21/,
      )
      await setTheme(page, theme)
      await shoot(page, `btw-422-${theme}-${label}.png`)
      await context.close()
    }
  }
})
