import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for #173 — bulk reminder confirm dialog.
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=173 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-173.spec.ts
 *
 * Fixture names: Eva Jansen, Ruben de Vries. Registry test IBAN only.
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '173'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
    document.documentElement.dataset['theme'] = value
  }, theme)
  await page.waitForTimeout(250)
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(50)
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
  })
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[style]')) {
      const value = el.getAttribute('style')
      if (value === null) continue
      if (value === '' || /caret-color:\s*transparent/i.test(value)) {
        el.removeAttribute('style')
      }
    }
  })
}

async function ready(page: Page, width: number): Promise<void> {
  if (width >= 768) {
    await hydrated(page)
  } else {
    await expect(page.getByRole('heading', { name: /Verkoop/ })).toBeVisible()
  }
}

function daysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

async function seedContact(page: Page, number: string, name: string, email: string): Promise<void> {
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill(number)
  await page.getByLabel('Naam', { exact: true }).fill(name)
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('87654321')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Straat').fill('Voorbeeldstraat')
  await page.getByLabel('Huisnr.').fill('1')
  await page.getByLabel('Postcode').fill('1000 AA')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name })).toBeVisible()
}

async function draftAndIssue(
  page: Page,
  customer: string,
  description: string,
  price: string,
  issueDate: string,
): Promise<void> {
  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByRole('combobox', { name: 'Klant' }).click()
  await page.getByRole('option', { name: new RegExp(customer) }).click()
  await page.getByLabel('Factuurdatum').fill(issueDate)
  await page.getByLabel('Referentie klant').fill(`PO-${description.slice(0, 8)}`)
  await page.getByLabel('Omschrijving regel 1').fill(description)
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Eenheid regel 1').fill('EA')
  await page.getByLabel('Prijs regel 1').fill(price)
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page.getByRole('heading', { name: /Factuur Concept/ })).toBeVisible()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('heading', { name: /Factuur \d{4}-/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'boeking', exact: true })).toBeVisible()
}

test('173 reminder confirm dialog light/dark 1440 and 390', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1040 })
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Noordwind Boekhouding BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)

  await page.goto('/settings')
  await page.getByLabel('Straat').fill('Demoweg')
  await page.getByLabel('Huisnummer').fill('10')
  await page.getByLabel('Postcode').fill('1000 BB')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('12345678')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL123456789B01')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()

  await page.goto('/contacts')
  await seedContact(page, 'DEB-EVA', 'Eva Jansen', 'eva@example.nl')
  await seedContact(page, 'DEB-RUBEN', 'Ruben de Vries', 'ruben@example.nl')
  await seedContact(page, 'DEB-3', 'Atelier Noordkust', 'atelier@example.nl')
  await seedContact(page, 'DEB-4', 'Molenaar Media', 'molenaar@example.nl')
  await seedContact(page, 'DEB-5', 'Hoveniers De Linden', 'linden@example.nl')
  await seedContact(page, 'DEB-6', 'Drukkerij Westland', 'westland@example.nl')

  // Six overdue reminders so the dialog shows 5 rows + "+1 meer".
  const jobs = [
    ['Eva Jansen', '500,00'],
    ['Ruben de Vries', '740,50'],
    ['Atelier Noordkust', '120,00'],
    ['Molenaar Media', '88,00'],
    ['Hoveniers De Linden', '210,00'],
    ['Drukkerij Westland', '95,00'],
  ] as const
  for (const [customer, price] of jobs) {
    await draftAndIssue(page, customer, `Herinnering ${customer}`, price, daysAgo(80))
  }

  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1440, height: 1040 })
    await page.goto('/dunning')
    await ready(page, 1440)
    await setTheme(page, theme)
    await page.getByRole('button', { name: /Alle 6 herinneringen versturen/ }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: /6 herinneringen versturen\?/ })).toBeVisible()
    await shot(page, `01-reminder-confirm-${theme}-desktop-1440`)
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dunning')
    await ready(page, 390)
    await setTheme(page, theme)
    await page.getByRole('button', { name: /Alle 6 herinneringen versturen/ }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await shot(page, `01-reminder-confirm-${theme}-mobile-390`)
    await page.keyboard.press('Escape')
  }
})
