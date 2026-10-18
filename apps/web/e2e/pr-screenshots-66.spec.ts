import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, openAccountMenu, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for PR #66 (design review).
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-66.spec.ts
 *
 * Writes under docs/pr-screenshots/66/ for raw.githubusercontent.com links.
 */

const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', '66')
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/66/')

async function anAdministration(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  // Desktop prints kbd chips; phone hides them and keeps Profiel in the Sheet.
  const viewport = page.viewportSize()
  if (viewport !== null && viewport.width < 768) {
    await expect(page.getByRole('button', { name: /Menu openen|Open menu/ })).toBeEnabled()
  } else {
    await hydrated(page)
    // A second beat: after several context cycles the first paint can lag
    // behind the heading, and a lone kbd wait flakes.
    await expect(page.getByRole('region', { name: 'Profiel' })).toBeVisible({ timeout: 15_000 })
  }
}

async function forceSaveFail(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    const request = route.request()
    if (request.method() === 'POST' && (request.postData() ?? '').includes('enabled')) {
      await route.fulfill({ status: 500, body: 'save failed' })
      return
    }
    await route.continue()
  })
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  // Avoid mid-transition captures (primary CTA / header icons mid-fade).
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForFunction(
    (wantDark) => document.documentElement.classList.contains('dark') === wantDark,
    theme === 'dark',
  )
  // Settle even when reducedMotion is imperfectly honoured by a transition.
  await page.waitForTimeout(250)
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, name), fullPage: false })
}

async function closeOverlays(page: Page): Promise<void> {
  // Popover / Sheet both answer to Escape; keep pressing until chrome is clear.
  for (let i = 0; i < 3; i += 1) {
    const menu = page.getByRole('dialog', { name: 'Profiel' })
    const sheet = page.getByRole('navigation', { name: 'Hoofdnavigatie' })
    const menuOpen = await menu.isVisible().catch(() => false)
    const width = page.viewportSize()?.width ?? 1440
    const sheetOpen = width < 768 && (await sheet.isVisible().catch(() => false))
    if (!menuOpen && !sheetOpen) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
}

test('capture Geavanceerd failure toast and help PNGs for #66', async ({ browser }) => {
  // —— Failure toast: menu open at 1440 light (also shows the switch reverted)
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await anAdministration(page, 'Shot Fail Desktop')
    await forceSaveFail(page)
    await openAccountMenu(page)
    await page.getByRole('switch', { name: /Geavanceerd/ }).click()
    await expect(page.getByTestId('advanced-mode-save-failed')).toBeVisible()
    await expect(page.getByRole('switch', { name: /Geavanceerd/ })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await setTheme(page, 'light')
    await shoot(page, 'fail-menu-light-desktop-1440.png')
    await context.close()
  }

  // —— Toast at 1440 / 390 × light / dark (4 shots); overlays closed so the
  //    toast sits alone above the chrome / form-actions clearance.
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of [
      ['desktop-1440', { width: 1440, height: 900 }],
      ['mobile-390', { width: 390, height: 844 }],
    ] as const) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await anAdministration(page, `Shot Toast ${theme} ${label}`)
      await forceSaveFail(page)
      if (size.width < 768) {
        await page.getByRole('button', { name: /Menu openen|Open menu/ }).click()
      }
      await openAccountMenu(page)
      await page.getByRole('switch', { name: /Geavanceerd/ }).click()
      await expect(page.getByTestId('advanced-mode-save-failed')).toBeVisible()
      await closeOverlays(page)
      await setTheme(page, theme)
      await expect(page.getByTestId('advanced-mode-save-failed')).toBeVisible()
      await shoot(page, `toast-${theme}-${label}.png`)
      await context.close()
    }
  }

  // —— ? help with Geavanceerd off: scroll to Nieuw so the missing
  //    "Nieuwe journaalpost" row is in frame next to "Nieuwe factuur".
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await anAdministration(page, 'Shot Help')
    await page.keyboard.press('?')
    const help = page.getByRole('dialog', { name: 'Sneltoetsen' })
    await expect(help).toBeVisible()
    const nieuwSection = help
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Nieuw', exact: true }) })
    await nieuwSection.scrollIntoViewIfNeeded()
    await expect(nieuwSection.getByRole('heading', { name: 'Nieuw', exact: true })).toBeVisible()
    await expect(nieuwSection.getByText('Nieuwe journaalpost')).toHaveCount(0)
    await expect(nieuwSection.getByText('Nieuwe factuur', { exact: true })).toBeVisible()
    await setTheme(page, 'light')
    await shoot(page, 'help-geavanceerd-off-light-desktop-1440.png')
    await context.close()
  }
})
