import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for the bank matching redesign PR (#61 slice 6).
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_NUMBER=<n> pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-bank-match.spec.ts
 *
 * Writes under docs/pr-screenshots/<n>/ and copies matching prototype frames
 * from the temporary checkout used at capture time (or /tmp/proto-shots).
 */

const PR = process.env['PR_NUMBER'] ?? '0'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const PROTO =
  process.env['PROTO_SHOTS'] ??
  join(import.meta.dirname, '..', '..', '..', 'prototypes', 'redesign', 'screenshots')
const PROTO_FALLBACK = '/tmp/proto-shots'
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
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

async function withBankQueue(page: Page, name: string): Promise<void> {
  await ready(page, name)
  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByLabel('Naam', { exact: true }).fill('ING Zakelijk')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL02ABNA0123456789')).toBeVisible()
  await expect(page.locator('input[type="file"]')).toBeEnabled()
  await page.setInputFiles('input[type="file"]', join(FIXTURES, 'statement.mt940'))
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await page.getByRole('button', { name: 'Inlezen', exact: true }).click()
  await expect(page.getByText('4 transacties ingelezen.')).toBeVisible()
  await page.goto('/bank/match')
  await expect(page.getByRole('heading', { name: 'Koppelen' })).toBeVisible()
  await hydrated(page)
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

function copyProto(name: string, dest: string): void {
  const fromProto = join(PROTO, name)
  const fromFallback = join(PROTO_FALLBACK, name)
  const src = existsSync(fromProto) ? fromProto : fromFallback
  if (existsSync(src)) copyFileSync(src, join(OUT, dest))
}

test('capture bank match PNGs (1440/390 × light/dark + empty + prototype)', async ({ browser }) => {
  test.setTimeout(600_000)

  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of [
      ['desktop-1440', { width: 1440, height: 900 }],
      ['mobile-390', { width: 390, height: 844 }],
    ] as const) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await withBankQueue(page, `Shot ${theme} ${label}`)
      await setTheme(page, theme)
      await shoot(page, `queue-${theme}-${label}.png`)

      // Empty: skip every line.
      for (;;) {
        const skip = page.getByRole('button', { name: 'Overslaan' })
        if (!(await skip.isVisible().catch(() => false))) break
        if (await skip.isDisabled().catch(() => true)) break
        await skip.click()
        await page.waitForTimeout(400)
        if (
          await page
            .getByText('Alles is gekoppeld.')
            .isVisible()
            .catch(() => false)
        )
          break
      }
      await shoot(page, `empty-${theme}-${label}.png`)
      await context.close()
    }
  }

  // Prototype side-by-sides (#57).
  copyProto('16-bank-match--desktop-light.png', 'prototype-queue-light-desktop-1440.png')
  copyProto('16-bank-match--desktop-dark.png', 'prototype-queue-dark-desktop-1440.png')
  copyProto('16-bank-match--mobile-light.png', 'prototype-queue-light-mobile-390.png')
  copyProto('16-bank-match--mobile-dark.png', 'prototype-queue-dark-mobile-390.png')
  copyProto(
    '17-bank-panel-two-candidates--desktop-light.png',
    'prototype-two-candidates-light-desktop-1440.png',
  )
  copyProto(
    '17-bank-panel-two-candidates--desktop-dark.png',
    'prototype-two-candidates-dark-desktop-1440.png',
  )
  copyProto('19-bank-matched--desktop-light.png', 'prototype-matched-light-desktop-1440.png')
})
