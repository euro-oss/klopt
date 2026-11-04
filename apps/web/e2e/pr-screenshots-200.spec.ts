import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'
import { installFiscalYearBookingFakeClock } from './support/fiscal-year-booking-fake-clock'
import { withPngSourceChunk } from './support/png-source-chunk.js'

const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', '200')
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'
const SCREENSHOT_SOURCE = 'apps/web/e2e/pr-screenshots-200.spec.ts'

const SIZES = [
  { label: 'desktop-1440', width: 1440, height: 900 },
  { label: 'mobile-390', width: 390, height: 844 },
] as const

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/200')

async function aSupplier(page: Page): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Leverancier B.V.')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL987654321B01')
  await page.getByLabel('E-mail').fill('facturen@leverancier.test')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Leverancier B\.V\./ })).toBeVisible()
}

async function setBillDate(page: Page, isoDate: string): Promise<void> {
  const field = page.getByLabel('Factuurdatum', { exact: true })
  await field.click()
  await field.fill(isoDate)
  await expect(field).toHaveValue(isoDate)
}

test.use({ timezoneId: 'Europe/Amsterdam' })

async function ready(page: Page): Promise<void> {
  await installFiscalYearBookingFakeClock(page)
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.goto('/setup')
  await page.getByLabel('Naam', { exact: true }).fill('Boekjaar Poort BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
  await aSupplier(page)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme })
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
  }, theme)
  if (theme === 'dark') {
    await expect(page.locator('html')).toHaveClass(/dark/)
  } else {
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  }
}

async function shoot(page: Page, name: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page.locator('body')).toBeVisible()
      const png = await page.screenshot({ fullPage: false, animations: 'disabled' })
      writeFileSync(
        join(OUT, `${name}-${theme}-${size.label}.png`),
        withPngSourceChunk(png, SCREENSHOT_SOURCE),
      )
    }
  }
}

test('capture #200 fiscal year booking gate screenshots', async ({ page }) => {
  test.setTimeout(600_000)
  await ready(page)

  await page.goto('/purchases/new')
  await hydrated(page)
  await setBillDate(page, '2025-12-15')
  await shoot(page, 'purchase-blocked')

  await page.getByRole('link', { name: 'Boekjaar 2025 openen' }).click()
  await page.getByRole('checkbox', { name: /Ik wil boekjaar 2025 openen/ }).check()
  await shoot(page, 'fiscal-years-prior-confirm')

  await page.getByRole('button', { name: 'Boekjaar 2025 openen' }).click()
  await expect(page).toHaveURL(/\/purchases\/new/, { timeout: 30_000 })
  await shoot(page, 'purchase-returned')

  await page.goto('/fiscal-years')
  await expect(page.getByRole('heading', { name: 'Boekjaren' })).toBeVisible()
  await expect(page.getByTestId('fiscal-year-prior-not-closed-hint')).toBeVisible({
    timeout: 30_000,
  })
  await shoot(page, 'fiscal-years-list')

  await shoot(page, 'fiscal-years-next-card')

  await page.getByRole('button', { name: 'Vorig boekjaar openen' }).click()
  await shoot(page, 'fiscal-years-both-actions')
})
