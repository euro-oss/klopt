import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { chooseOption, DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'
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
  await page.getByLabel('E-mail').fill('leverancier@example.nl')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Leverancier B\.V\./ })).toBeVisible()
}

async function aCustomer(page: Page): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Klant B.V.')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL123456789B01')
  await page.getByLabel('E-mail').fill('klant@example.nl')
  await page.getByRole('checkbox', { name: /Klant/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Klant B\.V\./ })).toBeVisible()
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
  await aCustomer(page)
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
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

async function shoot(page: Page, name: string, scrollTarget?: Locator): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height })
      await expect(page.locator('body')).toBeVisible()
      if (scrollTarget !== undefined) {
        await scrollTarget.scrollIntoViewIfNeeded()
        await expect(scrollTarget).toBeVisible()
        const box = await scrollTarget.boundingBox()
        if (box !== null) {
          const png = await page.screenshot({
            animations: 'disabled',
            clip: {
              x: Math.max(0, box.x - 12),
              y: Math.max(0, box.y - 12),
              width: box.width + 24,
              height: box.height + 24,
            },
          })
          writeFileSync(
            join(OUT, `${name}-${theme}-${size.label}.png`),
            withPngSourceChunk(png, SCREENSHOT_SOURCE),
          )
          continue
        }
      } else {
        await page.evaluate(() => window.scrollTo(0, 0))
        await expect
          .poll(() => page.evaluate(() => window.scrollY))
          .toBe(0)
      }
      await expect(page.locator('body')).toBeVisible()
      const png = await page.screenshot({ fullPage: false, animations: 'disabled' })
      writeFileSync(
        join(OUT, `${name}-${theme}-${size.label}.png`),
        withPngSourceChunk(png, SCREENSHOT_SOURCE),
      )
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => window.scrollTo(0, 0))
}

async function openBookYear(page: Page, code: string): Promise<void> {
  const opened = await page.request.post('/api/v1/fiscal-years', {
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    data: { code },
  })
  expect(opened.ok()).toBeTruthy()
}

test('capture #200 fiscal year booking gate screenshots', async ({ page, browser }) => {
  test.setTimeout(900_000)
  await ready(page)

  await page.goto('/purchases/new')
  await hydrated(page)
  await setBillDate(page, '2025-12-15')
  await expect(page.getByText('Boekjaar 2025 is nog niet geopend.')).toBeVisible()
  await expect(page.getByText('Kies een andere')).toHaveCount(0)
  await shoot(page, 'purchase-blocked')

  await shoot(page, 'purchase-date-hint', page.locator('#purchase-invoice-date-hint'))

  await page.goto('/invoices/new')
  await hydrated(page)
  await page.locator('#cust-q').fill('Klant')
  await page.getByRole('option', { name: 'Klant B.V.' }).click()
  await expect(page.getByText(/We vullen alvast in:/)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Verder/ }).click()
  await expect(page.getByText('Stap 2 van 4')).toBeVisible()
  await page.locator('#inv-date').fill('15-12-2025')
  await page.locator('#inv-date').blur()
  await expect(page.locator('#guided-invoice-date-hint')).toContainText(
    'Boekjaar 2025 is nog niet geopend.',
  )
  await shoot(page, 'invoice-blocked', page.locator('#guided-invoice-date-hint'))

  const owner = await browser.newContext()
  const auditor = await browser.newContext()
  try {
    const ownerPage = await owner.newPage()
    await ready(ownerPage)
    const auditorEmail = uniqueEmail()
    const auditorPage = await auditor.newPage()
    await installFiscalYearBookingFakeClock(auditorPage)
    await auditorPage.goto('/sign-in')
    await signIn(auditorPage, auditorEmail)
    await expect(auditorPage.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

    await ownerPage.goto('/members')
    const invite = ownerPage.locator('form', {
      has: ownerPage.getByRole('button', { name: 'Uitnodigen' }),
    })
    await invite.getByLabel('E-mail').fill(auditorEmail)
    await chooseOption(ownerPage, 'Rol', 'Controleur', invite)
    await ownerPage.getByRole('button', { name: 'Uitnodigen' }).click()
    await expect(ownerPage.getByText(new RegExp(`${auditorEmail} heeft nu toegang`))).toBeVisible()

    await auditorPage.reload()
    await expect(
      auditorPage.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
    ).toBeVisible({ timeout: 30_000 })
    await hydrated(auditorPage)
    await auditorPage.goto('/purchases/new')
    await hydrated(auditorPage)
    await setBillDate(auditorPage, '2025-12-15')
    await expect(auditorPage.getByRole('link', { name: 'Boekjaar 2025 openen' })).toHaveCount(0)
    await shoot(auditorPage, 'purchase-no-link', auditorPage.locator('#purchase-invoice-date-hint'))
  } finally {
    await owner.close()
    await auditor.close()
  }

  await page.goto('/fiscal-years')
  await hydrated(page)
  await expect(page.getByTestId('fiscal-years-open-section')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Boekjaar 2025 openen' })).toBeVisible()
  await shoot(page, 'fiscal-years-open-actions', page.getByTestId('fiscal-years-open-section'))

  await page.getByRole('button', { name: 'Boekjaar 2025 openen' }).click()
  await expect(page.getByTestId('open-prior-year')).toBeVisible()
  await shoot(page, 'fiscal-years-prior-expanded', page.getByTestId('fiscal-years-open-section'))

  await page.goto('/purchases/new')
  await hydrated(page)
  await setBillDate(page, '2025-12-15')
  await page.getByRole('link', { name: 'Boekjaar 2025 openen' }).click()
  await expect(page.getByTestId('open-prior-year')).toBeVisible()
  await expect(page.getByTestId('fixed-year-open-code')).toHaveText('2025')
  await shoot(
    page,
    'fiscal-years-deeplink-confirm',
    page.getByRole('button', { name: 'Boekjaar 2025 openen' }),
  )

  await page.getByRole('checkbox', { name: /Ik wil boekjaar 2025 openen/ }).check()
  await expect(page.getByRole('checkbox', { name: /Ik wil boekjaar 2025 openen/ })).toBeChecked()
  await shoot(page, 'fiscal-years-prior-confirm', page.getByTestId('open-prior-year'))

  await page.getByRole('button', { name: 'Boekjaar 2025 openen' }).click()
  await expect(page).toHaveURL(/\/purchases\/new/, { timeout: 30_000 })
  await expect(page.getByLabel('Factuurdatum', { exact: true })).toHaveValue('2025-12-15')
  await shoot(page, 'purchase-returned', page.getByLabel('Factuurdatum', { exact: true }))

  await openBookYear(page, '2024')
  await page.goto('/fiscal-years')
  await hydrated(page)
  const pluralHint = page.getByTestId('fiscal-year-prior-not-closed-hint').filter({
    hasText:
      'Boekjaren 2024 en 2025 zijn nog niet afgesloten; de resultaten staan nog niet in de beginbalans van 2026.',
  })
  await expect(pluralHint).toBeVisible()
  await shoot(page, 'fiscal-years-list', pluralHint)

  await shoot(page, 'fiscal-years-next-card', page.getByTestId('derived-dates'))
})
