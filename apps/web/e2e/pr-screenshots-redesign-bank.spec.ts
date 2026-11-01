import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * Desktop-light 1440 PNGs for the Bank Match redesign PR (#129).
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
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByLabel('Naam', { exact: true }).fill('Demo bankrekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.locator('input[type="file"]')).toBeEnabled()
  await page.setInputFiles('input[type="file"]', join(FIXTURES, 'statement.mt940'))
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await page.getByRole('button', { name: 'Importeren', exact: true }).click()
  await expect(page.getByText('4 transacties geïmporteerd.')).toBeVisible()
}

async function shot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.screenshot({
    path: join(OUT, name),
    fullPage: true,
    animations: 'disabled',
  })
}

test('01 empty light desktop 1440', async ({ page }) => {
  await ready(page, 'Bank Shot Empty BV')
  await page.goto('/bank/match')
  await hydrated(page)
  await expect(page.getByText('Alle regels zijn geboekt')).toBeVisible()
  await shot(page, '01-bank-match-empty-light-desktop-1440.png')
})

test('02 seeded light desktop 1440', async ({ page }) => {
  await ready(page, 'Bank Shot Seed BV')
  await importStatement(page)
  await page.goto('/bank/match')
  await hydrated(page)
  await expect(page.locator('[data-slot="match-queue"] [data-row]')).toHaveCount(4)
  await expect(page.getByRole('heading', { name: 'Wat was dit?' })).toBeVisible()
  await shot(page, '02-bank-match-seeded-light-desktop-1440.png')
})
