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
 * Writes under docs/pr-screenshots/<pr>/ once the PR number is known; default 69.
 * Captures the lab under the real `_app` shell (nav + findings), full page.
 *
 * Designer #69 item 1 states: warning card, one-click preview, explain-only,
 * period_locked, Opgelost, keyboard strip, sheets at 390/dark, Geavanceerd
 * (numbers / VH21 / Debet·Credit), live FX € 1.429,84 / € 1.424,76, direction
 * filtered btw picker, sticky mapping table at 390.
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '69'
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
  await page.screenshot({ path: join(OUT, name), fullPage: true })
}

async function openFindings(page: Page, search: string): Promise<void> {
  await page.goto(`/lab/import-findings?${search}`)
  await expect(page.locator('[data-slot="import-findings"]')).toBeVisible({ timeout: 15_000 })
}

/** Expand the states Designer item 1 lists into view before a full-page shot. */
async function revealReviewStates(page: Page): Promise<void> {
  // One-click fix with its preview open.
  const tax = page.locator('[data-slot="finding-card"][data-code="unmapped_tax_rate"]')
  await tax.scrollIntoViewIfNeeded()
  await tax.getByRole('button', { name: 'Gebruik 9% btw' }).click()
  await expect(tax).toHaveAttribute('data-fix-open', 'true')
  await expect(tax.getByText('Dit verandert wat er geïmporteerd wordt')).toBeVisible()

  // Let op warning + explain-only + period_locked + Opgelost + keyboard strip.
  await expect(page.getByText('Let op').first()).toBeVisible()
  const draft = page.locator('[data-slot="finding-card"][data-code="draft_skipped"]')
  await expect(draft).toBeVisible()
  await expect(draft.getByText('Dit los je niet hier op.')).toBeVisible()
  await expect(draft.getByText('CONCEPT-4')).toBeVisible()
  await expect(page.locator('[data-slot="finding-card"][data-code="period_locked"]')).toBeVisible()
  await expect(page.getByText('Opgelost').first()).toBeVisible()
  // ShortcutFooter / in-button chips: desktop only (#69; CSS-hidden < md).
  const width = page.viewportSize()?.width ?? 0
  const firstKbd = page.locator('[data-slot="import-findings"] kbd').first()
  if (width >= 768) {
    await expect(firstKbd).toBeVisible()
  } else {
    await expect(firstKbd).toBeHidden()
  }
}

test('capture import findings PNGs (1440/390 × light/dark + sheets + states)', async ({
  browser,
}) => {
  test.setTimeout(600_000)
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of [
      ['desktop-1440', { width: 1440, height: 900 }],
      ['mobile-390', { width: 390, height: 844 }],
    ] as const) {
      {
        const context = await browser.newContext({ viewport: size })
        const page = await context.newPage()
        await ready(page, `Findings ${theme} ${label}`)
        await openFindings(page, 'source=moneybird&state=open')
        await revealReviewStates(page)
        await setTheme(page, theme)
        await shoot(page, `findings-${theme}-${label}.png`)
        await context.close()
      }
      {
        const context = await browser.newContext({ viewport: size })
        const page = await context.newPage()
        await ready(page, `Empty ${theme} ${label}`)
        await openFindings(page, 'source=moneybird&state=empty')
        await expect(page.getByText('Alles is nagekeken')).toBeVisible()
        await setTheme(page, theme)
        await shoot(page, `findings-empty-${theme}-${label}.png`)
        await context.close()
      }
    }
  }

  // Category sheet — desktop + mobile, light + dark.
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of [
      ['desktop-1440', { width: 1440, height: 900 }],
      ['mobile-390', { width: 390, height: 844 }],
    ] as const) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `Account ${theme} ${label}`)
      await openFindings(page, 'source=moneybird&state=open&sheet=account')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByText('Beste match eerst')).toBeVisible()
      await setTheme(page, theme)
      await shoot(page, `fix-account-vat-${theme}-${label}.png`)
      await context.close()
    }
  }

  // Direction-filtered btw: purchase 21% → VH21; sales 0% → five codes, none prefilled.
  // Toggle Geavanceerd before opening the sheet — the overlay blocks the checkbox.
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of [
      ['desktop-1440', { width: 1440, height: 900 }],
      ['mobile-390', { width: 390, height: 844 }],
    ] as const) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `Tax ${theme} ${label}`)
      await openFindings(page, 'source=moneybird&state=open')
      await page.getByTestId('lab-advanced').check()
      await expect(page.getByTestId('lab-advanced')).toBeChecked()
      await openFindings(page, 'source=moneybird&state=open&sheet=tax')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByText('VH21', { exact: true })).toBeVisible()
      await expect(page.getByRole('dialog').getByRole('radio')).toHaveCount(1)
      await setTheme(page, theme)
      await shoot(page, `fix-tax-vat-${theme}-${label}.png`)
      await context.close()
    }
  }
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await ready(page, 'Tax 0% sales')
    await openFindings(page, 'source=moneybird&state=open')
    await page.getByTestId('lab-advanced').check()
    await openFindings(page, 'source=moneybird&state=open&sheet=tax0')
    await expect(page.getByRole('dialog').getByRole('radio')).toHaveCount(5)
    await expect(page.getByRole('dialog').getByRole('radio', { checked: true })).toHaveCount(0)
    await setTheme(page, 'light')
    await shoot(page, 'fix-tax-vat-zero-light-desktop-1440.png')
    await context.close()
  }
  // Empty / unknown rate: vatUnknown status once, no duplicate hint (#69 design).
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await ready(page, 'Tax empty rate')
    await openFindings(page, 'source=moneybird&state=open&sheet=taxEmpty')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('status')).toContainText(/We weten niet welk tarief dit is/)
    await expect(
      page.getByRole('dialog').getByText(/We weten niet welk tarief dit is/),
    ).toHaveCount(1)
    await setTheme(page, 'light')
    await shoot(page, 'fix-tax-vat-empty-light-desktop-1440.png')
    await context.close()
  }

  // FX ECB + override — prove live € 1.429,84 / € 1.424,76; advanced Debet/Credit; dark + 390.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await ready(page, 'FX ECB')
    await openFindings(page, 'source=moneybird&state=open&sheet=fx')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('€ 1.429,84').first()).toBeVisible()
    await expect(page.getByText(/Euro per 1 Britse pond/)).toBeVisible()
    await setTheme(page, 'light')
    await shoot(page, 'fix-fx-ecb-light-desktop-1440.png')
    await page.locator('#fx-rate-input').fill('1,1490')
    await expect(page.getByText(/Aangepast ·/)).toBeVisible()
    await expect(page.getByText('€ 1.424,76').first()).toBeVisible()
    await shoot(page, 'fix-fx-override-light-desktop-1440.png')
    await page.getByRole('button', { name: /Terug naar ECB/ }).click()
    await expect(page.getByText('€ 1.429,84').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByTestId('lab-advanced').check()
    await page
      .locator('[data-slot="finding-card"][data-code="unknown_currency"]')
      .getByRole('button', { name: 'Koers kiezen' })
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Debet')).toBeVisible()
    await expect(page.getByText('€ 1.429,84').first()).toBeVisible()
    await shoot(page, 'fix-fx-advanced-light-desktop-1440.png')
    await setTheme(page, 'dark')
    await shoot(page, 'fix-fx-ecb-dark-desktop-1440.png')
    await context.close()
  }
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await ready(page, 'FX mobile')
    await openFindings(page, 'source=moneybird&state=open&sheet=fx')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('€ 1.429,84').first()).toBeVisible()
    await setTheme(page, 'light')
    await shoot(page, 'fix-fx-ecb-light-mobile-390.png')
    await setTheme(page, 'dark')
    await shoot(page, 'fix-fx-ecb-dark-mobile-390.png')
    await context.close()
  }

  // Geavanceerd on: paths + numbers visible on findings.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await ready(page, 'Advanced findings')
    await openFindings(page, 'source=moneybird&state=open')
    await page.getByTestId('lab-advanced').check()
    await expect(page.getByText('ledger_accounts/389114002')).toBeVisible()
    await revealReviewStates(page)
    await setTheme(page, 'light')
    await shoot(page, 'findings-advanced-light-desktop-1440.png')
    await context.close()
  }

  // Sticky mapping table at 390 — no horizontal page scroll (Designer §9).
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await ready(page, 'Mapping table phone')
    await openFindings(page, 'source=moneybird&state=open')
    const table = page.locator('[data-slot="scroll-table"]').first()
    await table.scrollIntoViewIfNeeded()
    await expect(table).toBeVisible()
    await setTheme(page, 'light')
    await shoot(page, 'mapping-table-light-mobile-390.png')
    await context.close()
  }
})
