import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'
import { startExactStandIn, type ExactStandIn } from './support/exact-stand-in'

/**
 * Public PNGs for the Exact VAT read-only wizard slice (#100).
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=<pr> \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-exact-vat.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? 'exact-vat'
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
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.goto('/setup')
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
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(100)
  await page.screenshot({ path: join(OUT, name), fullPage: false })
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

async function reachBtw(page: Page, standIn: ExactStandIn): Promise<void> {
  await page.goto('/importeren?bron=exact')
  await expect(page.getByRole('radio', { name: /Exact Online/ })).toBeEnabled({ timeout: 15_000 })
  await page.getByRole('radio', { name: /Exact Online/ }).click()
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Verbind met Exact Online/ })).toBeVisible()
  await page
    .locator('details')
    .filter({ hasText: /Geavanceerd|Boekhouddetails/ })
    .locator('summary')
    .click()
  await page.getByLabel('Exact-omgeving').fill(standIn.baseUrl)
  await page.getByLabel('Client ID').fill(standIn.clientId)
  await page.getByLabel('Client secret').fill(standIn.clientSecret)
  await page.getByLabel('Redirect-URI').fill(`${new URL(page.url()).origin}/exact/callback`)
  await clickNext(page)
  const adminHeading = page.getByRole('heading', {
    name: /Welke administratie en welk boekjaar/,
  })
  const resumeHeading = page.getByRole('heading', { name: /Welkom terug/ })
  await expect(adminHeading.or(resumeHeading)).toBeVisible({ timeout: 60_000 })
  if (await resumeHeading.isVisible()) {
    await page.getByRole('button', { name: /Doorgaan/i }).click()
  }
  await expect(adminHeading).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: /Administraties ophalen|Opnieuw ophalen/ }).click()
  await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
  await page.getByText('Voorbeeld BV').click()
  await page.getByLabel(/Boekjaar om te importeren/).fill('2026')
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByRole('term').filter({ hasText: 'Btw-codes' })).toBeVisible({
    timeout: 60_000,
  })
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Btw-codes uit Exact/ })).toBeVisible({
    timeout: 30_000,
  })
}

test('Exact VAT preview light+dark desktop+phone', async ({ page }) => {
  test.setTimeout(240_000)
  process.env['KLOPT_ENCRYPTION_KEY'] = 'e2e-encryption-key-not-for-production-01234'
  const standIn = await startExactStandIn()
  try {
    await ready(page, 'Exact Screenshot BV')

    // Bron with Exact selected — capture before OAuth so resume does not hide cards.
    await page.goto('/importeren?bron=exact')
    await expect(page.getByRole('radio', { name: /Exact Online/ })).toBeEnabled({ timeout: 15_000 })
    await page.getByRole('radio', { name: /Exact Online/ }).click()
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await page.setViewportSize({ width: 1440, height: 900 })
      await shoot(page, `01-bron-exact-${theme}-desktop-1440.png`)
      await page.setViewportSize({ width: 390, height: 844 })
      await shoot(page, `01-bron-exact-${theme}-mobile-390.png`)
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    await reachBtw(page, standIn)

    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await page.setViewportSize({ width: 1440, height: 900 })
      await shoot(page, `05-btw-exact-${theme}-desktop-1440.png`)
      await page.setViewportSize({ width: 390, height: 844 })
      await shoot(page, `05-btw-exact-${theme}-mobile-390.png`)
    }
  } finally {
    await standIn.close()
  }
})
