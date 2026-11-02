import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

/**
 * PR screenshots for BankAccounts redesign (#129 / #140 board).
 *
 * Must-have: desktop-light 1440 empty + seeded. Dark/phone are follow-ups (#143).
 * Fixture data: example IBAN NL91ABNA0417164300 only (CoS / Legal).
 *
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=<pr> \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-bank-accounts.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '129'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'core',
  'test',
  'bank',
  '__fixtures__',
)

const EXAMPLE_IBAN = 'NL91ABNA0417164300'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function openAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Bank Accounts Schermafdruk BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
}

async function seedBank(page: Page): Promise<void> {
  await page.goto('/bank')
  await hydrated(page)
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill(EXAMPLE_IBAN)
  await page.getByLabel('Naam', { exact: true }).fill('Demo bankrekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL91 ABNA 0417 1643 00')).toBeVisible()

  await expect(page.locator('[data-slot="drop-zone"] input[type="file"]')).toBeEnabled()
  await page.setInputFiles(
    '[data-slot="drop-zone"] input[type="file"]',
    join(FIXTURES, 'statement.mt940'),
  )
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await page.getByRole('button', { name: 'Importeren', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Transacties' })).toBeVisible()
}

async function persistThemeCookie(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.context().addCookies([
    {
      name: 'klopt_theme',
      value: theme,
      domain: 'localhost',
      path: '/',
    },
  ])
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await persistThemeCookie(page, theme)
  await page.evaluate((t) => {
    document.cookie = `klopt_theme=${t}; path=/; max-age=31536000; samesite=lax`
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForFunction(
    (wantDark) => document.documentElement.classList.contains('dark') === wantDark,
    theme === 'dark',
  )
  await page.waitForTimeout(250)
}

async function shoot(
  page: Page,
  name: string,
  size: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(size)
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(OUT, name), fullPage: false })
}

test('01 empty — desktop-light 1440 (must-have)', async ({ page }) => {
  await openAdmin(page)
  await persistThemeCookie(page, 'light')
  await page.goto('/bank')
  await setTheme(page, 'light')
  await expect(page.getByText(/Nog geen bankrekening/)).toBeVisible()
  await shoot(page, '01-bank-accounts-empty-light-desktop-1440.png', {
    width: 1440,
    height: 1040,
  })
})

test('02 seeded — desktop-light 1440 (must-have)', async ({ page }) => {
  await openAdmin(page)
  await seedBank(page)
  await persistThemeCookie(page, 'light')
  await page.goto('/bank')
  await setTheme(page, 'light')
  await expect(page.getByText('Demo bankrekening')).toBeVisible()
  await expect(page.getByText('NL91 ABNA 0417 1643 00')).toBeVisible()
  await expect(page.getByText('Bankafschrift importeren').first()).toBeVisible()
  // IBAN must stay on one line (Design: badge moved off the IBAN row).
  const iban = page.locator('[data-slot="bank-account-iban"]').first()
  const metrics = await iban.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      height: el.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(style.lineHeight),
    }
  })
  expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight * 1.2)
  await shoot(page, '02-bank-accounts-seeded-light-desktop-1440.png', {
    width: 1440,
    height: 1040,
  })
})

test('02 seeded — light/dark × 1440/390 (IBAN nowrap check)', async ({ page }) => {
  await openAdmin(page)
  await seedBank(page)
  for (const theme of ['light', 'dark'] as const) {
    for (const size of [
      { width: 1440, height: 1040, tag: 'desktop-1440' },
      { width: 390, height: 844, tag: 'mobile-390' },
    ] as const) {
      await persistThemeCookie(page, theme)
      await page.goto('/bank')
      await setTheme(page, theme)
      await expect(page.getByText('NL91 ABNA 0417 1643 00')).toBeVisible()
      const ibanBox = await page.getByText('NL91 ABNA 0417 1643 00').boundingBox()
      expect(ibanBox).not.toBeNull()
      expect(ibanBox!.height).toBeLessThan(28)
      await shoot(page, `02-bank-accounts-seeded-${theme}-${size.tag}.png`, size)
    }
  }
})
