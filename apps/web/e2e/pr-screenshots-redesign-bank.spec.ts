import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * Light/dark × 1440/390 PNGs for the Bank Match redesign PR (#129).
 *
 *   CAPTURE_PR_SCREENSHOTS=1 PR_NUMBER=<n> pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-redesign-bank.spec.ts
 */

const PR = process.env['PR_NUMBER'] ?? '0'
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

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 and PR_NUMBER to write screenshots')

async function ready(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
}

async function importStatement(page: Page): Promise<void> {
  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByLabel('Naam', { exact: true }).fill('Demo bankrekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('input[type="file"]')).toBeEnabled()
  await page.setInputFiles('input[type="file"]', join(FIXTURES, 'statement.mt940'))
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await page.getByRole('button', { name: 'Importeren', exact: true }).click()
  await expect(page.getByText('4 transacties geïmporteerd.')).toBeVisible()
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

async function shot(
  page: Page,
  name: string,
  size: { width: number; height: number },
  theme: 'light' | 'dark',
): Promise<void> {
  await page.setViewportSize(size)
  await setTheme(page, theme)
  await page.screenshot({
    path: join(OUT, name),
    fullPage: true,
    animations: 'disabled',
  })
}

const VARIANTS = [
  { label: 'desktop-1440', size: { width: 1440, height: 900 } },
  { label: 'mobile-390', size: { width: 390, height: 844 } },
] as const

test('Bank Match screenshots: empty + seeded × light/dark × 1440/390', async ({ page }) => {
  test.setTimeout(420_000)

  await ready(page, 'Bank Shot Empty BV')
  await page.goto('/bank/match')
  await hydrated(page)
  await expect(page.getByText('Alle regels zijn geboekt')).toBeVisible()

  let n = 1
  for (const theme of ['light', 'dark'] as const) {
    for (const { label, size } of VARIANTS) {
      await shot(
        page,
        `${String(n).padStart(2, '0')}-bank-match-empty-${theme}-${label}.png`,
        size,
        theme,
      )
      n += 1
    }
  }

  // Same session: a second sign-in after a 390 viewport leaves /sign-in
  // redirected to Home with no E-mail field.
  await page.setViewportSize({ width: 1440, height: 900 })
  await setTheme(page, 'light')
  await importStatement(page)
  await page.goto('/bank/match')
  await hydrated(page)
  await expect(page.locator('[data-slot="match-queue"] [data-row]')).toHaveCount(4)
  await expect(page.getByRole('heading', { name: 'Wat was dit?' })).toBeVisible()

  for (const theme of ['light', 'dark'] as const) {
    for (const { label, size } of VARIANTS) {
      await shot(
        page,
        `${String(n).padStart(2, '0')}-bank-match-seeded-${theme}-${label}.png`,
        size,
        theme,
      )
      n += 1
    }
  }
})
