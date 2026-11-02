import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn } from './support'
import { startExactStandIn, type ExactStandIn } from './support/exact-stand-in'

/**
 * Public PNGs for the Exact VAT read-only wizard slice (#100 / #161 Design).
 *
 * Sample data: eva@bakkerij.example / Bakkerij Eva BV / Exact user Ruben.
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=<pr> \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-exact-vat.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? 'exact-vat'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

const EVA_EMAIL = 'eva@bakkerij.example'
const EVA_ADMIN = 'Bakkerij Eva BV'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function ready(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, EVA_EMAIL)
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.goto('/setup')
  await page.getByLabel('Naam van de administratie').fill(EVA_ADMIN)
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
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(100)
  await page.screenshot({ path: join(OUT, name), fullPage: true })
}

async function shootMatrix(page: Page, stem: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    await page.setViewportSize({ width: 1440, height: 900 })
    await shoot(page, `${stem}-${theme}-desktop-1440.png`)
    await page.setViewportSize({ width: 390, height: 844 })
    await shoot(page, `${stem}-${theme}-mobile-390.png`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await setTheme(page, 'light')
}

async function clickNext(page: Page): Promise<void> {
  const next = page.locator('button[data-focus="next"]')
  await expect
    .poll(
      async () => {
        const aria = await next.getAttribute('aria-disabled')
        return aria !== 'true' && aria !== ''
      },
      { timeout: 60_000 },
    )
    .toBe(true)
  await next.click()
}

async function fillStandIn(page: Page, standIn: ExactStandIn): Promise<void> {
  await page
    .locator('details')
    .filter({ hasText: /Geavanceerd|Boekhouddetails/ })
    .locator('summary')
    .click()
  await page.getByLabel('Exact-omgeving').fill(standIn.baseUrl)
  await page.getByLabel('Client ID').fill(standIn.clientId)
  await page.getByLabel('Client secret').fill(standIn.clientSecret)
  await page.getByLabel('Redirect-URI').fill(`${new URL(page.url()).origin}/exact/callback`)
}

test('Exact VAT preview — all 5 steps, Eva/Ruben, light+dark desktop+phone', async ({ page }) => {
  test.setTimeout(360_000)
  process.env['KLOPT_ENCRYPTION_KEY'] = 'e2e-encryption-key-not-for-production-01234'
  const standIn = await startExactStandIn()
  try {
    await ready(page)

    // 01 Bron — Exact selected (before OAuth so resume does not hide cards).
    await page.goto('/importeren?bron=exact')
    await expect(page.getByRole('radio', { name: /Exact Online/ })).toBeEnabled({
      timeout: 15_000,
    })
    await page.getByRole('radio', { name: /Exact Online/ }).click()
    await expect(page.getByText(EVA_EMAIL)).toBeVisible()
    await expect(page.getByText(EVA_ADMIN).first()).toBeVisible()
    await shootMatrix(page, '01-bron-exact')

    // 02 Verbinden — empty form.
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Verbind met Exact Online/ })).toBeVisible()
    await fillStandIn(page, standIn)
    await shootMatrix(page, '02-verbinden-exact-form')

    // OAuth → Administratie (no Welkom terug).
    await clickNext(page)
    const adminHeading = page.getByRole('heading', {
      name: /Welke administratie en welk boekjaar/,
    })
    await expect(adminHeading).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('heading', { name: /Welkom terug/ })).toHaveCount(0)

    // 02 Verbinden — connected card (Ruben).
    await page.getByRole('button', { name: /Terug/ }).click()
    await expect(page.getByText('Ruben')).toBeVisible()
    await expect(page.getByText(/Verbonden met Exact Online/)).toBeVisible()
    await shootMatrix(page, '02-verbinden-exact-connected')
    await clickNext(page)
    await expect(adminHeading).toBeVisible({ timeout: 30_000 })

    // 03 Administratie.
    await page.getByRole('button', { name: /Administraties ophalen|Opnieuw ophalen/ }).click()
    await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
    await page.getByText('Voorbeeld BV').click()
    await page.getByLabel(/Boekjaar om te importeren/).fill('2026')
    await shootMatrix(page, '03-administratie-exact')

    // 04 Voorbeeld.
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.getByRole('term').filter({ hasText: 'Btw-codes' })).toBeVisible({
      timeout: 60_000,
    })
    await shootMatrix(page, '04-voorbeeld-exact')

    // 05 Btw — Back only; full-page so end card + footer clear.
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Btw-codes uit Exact/ })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText(/4 van 7 herkend/)).toBeVisible()
    await expect(page.getByText(/Nog niet in deze versie/)).toBeVisible()
    await expect(page.locator('button[data-focus="next"]')).toHaveCount(0)
    await shootMatrix(page, '05-btw-exact')
  } finally {
    await standIn.close()
  }
})
