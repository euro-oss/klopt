import { mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for the dashboard werklijst redesign PR (#61 slice 3).
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_NUMBER=<n> pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-dashboard.spec.ts
 *
 * Writes under docs/pr-screenshots/<n>/ and copies matching prototype frames.
 */

const PR = process.env['PR_NUMBER'] ?? '0'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const PROTO = join(import.meta.dirname, '..', '..', '..', 'prototypes', 'redesign', 'screenshots')
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 and PR_NUMBER to write screenshots')

async function anAdministration(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  const viewport = page.viewportSize()
  if (viewport !== null && viewport.width >= 768) {
    await hydrated(page)
  }
}

async function aDraftInvoice(page: Page): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Wachtende Klant N.V.')
  await page.getByLabel('E-mail').fill('inkoop@wachtendeklant.nl')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Wachtende Klant N.V.' })).toBeVisible()

  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Omschrijving regel 1').fill('Advieswerk')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Prijs regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page.getByRole('heading', { name: /Factuur Concept/ })).toBeVisible()
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

function copyPrototype(name: string, dest: string): void {
  // Prefer tip SHA files from the prototype branch when present on disk;
  // otherwise skip — the PR body still links raw.githubusercontent.com.
  const candidates = [join(PROTO, name), join('/tmp/prototype-screenshots', name)]
  for (const src of candidates) {
    if (existsSync(src)) {
      copyFileSync(src, join(OUT, dest))
      return
    }
  }
}

test('dashboard werklijst screenshots', async ({ page }) => {
  await anAdministration(page, 'Screenshot Werklijst BV')

  // Empty / near-empty: light + dark, desktop + mobile.
  await page.setViewportSize({ width: 1440, height: 900 })
  await setTheme(page, 'light')
  await shoot(page, 'empty-light-desktop-1440.png')
  await setTheme(page, 'dark')
  await shoot(page, 'empty-dark-desktop-1440.png')

  await page.setViewportSize({ width: 390, height: 844 })
  await setTheme(page, 'light')
  await shoot(page, 'empty-light-mobile-390.png')
  await setTheme(page, 'dark')
  await shoot(page, 'empty-dark-mobile-390.png')

  // Populated werklijst.
  await page.setViewportSize({ width: 1440, height: 900 })
  await setTheme(page, 'light')
  await aDraftInvoice(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Wat aandacht vraagt' })).toBeVisible()
  await shoot(page, 'populated-light-desktop-1440.png')
  await setTheme(page, 'dark')
  await shoot(page, 'populated-dark-desktop-1440.png')

  await page.setViewportSize({ width: 390, height: 844 })
  await setTheme(page, 'light')
  await shoot(page, 'populated-light-mobile-390.png')
  await setTheme(page, 'dark')
  await shoot(page, 'populated-dark-mobile-390.png')

  // Prototype side-by-sides when available from the fetched tip.
  copyPrototype('01-dashboard--desktop-light.png', 'proto-dashboard-desktop-light.png')
  copyPrototype('01-dashboard--desktop-dark.png', 'proto-dashboard-desktop-dark.png')
  copyPrototype('01-dashboard--mobile-light.png', 'proto-dashboard-mobile-light.png')
  copyPrototype('01-dashboard--mobile-dark.png', 'proto-dashboard-mobile-dark.png')
})
