import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { addCalendarDays, todayInAmsterdam } from '../src/lib/amsterdam-date.js'
import { withPngSourceChunk } from './support/png-source-chunk.js'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

/**
 * PR screenshots for #195 item 1 — customer open + overdue styling.
 *
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=195 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-contacts-195.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '195'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'
const SCREENSHOT_SOURCE = 'apps/web/e2e/pr-screenshots-contacts-195.spec.ts'

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

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function openAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Open Schermafdruk BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
}

async function persistThemeCookie(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page
    .context()
    .addCookies([{ name: 'klopt_theme', value: theme, domain: 'localhost', path: '/' }])
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

async function seedEntityForSales(page: Page): Promise<void> {
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
}

async function importBankStatement(page: Page): Promise<void> {
  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByLabel('Naam', { exact: true }).fill('Rekening-courant')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL91 ABNA 0417 1643 00')).toBeVisible()
  await expect(page.locator('[data-slot="drop-zone"] input[type="file"]')).toBeEnabled()
  await page.setInputFiles(
    '[data-slot="drop-zone"] input[type="file"]',
    join(FIXTURES, 'statement.mt940'),
  )
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await page.getByRole('button', { name: 'Importeren', exact: true }).click()
  await expect(page.getByText('4 transacties geïmporteerd.')).toBeVisible()
}

async function seedCustomer(page: Page, number: string, name: string): Promise<string> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill(number)
  await page.getByLabel('Naam', { exact: true }).fill(name)
  await page.getByLabel('E-mail').fill('facturen@example.nl')
  await page.getByLabel('Straat').fill('Demoweg')
  await page.getByLabel('Huisnr.').fill('10')
  await page.getByLabel('Postcode').fill('1000 AA')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible()
  const id = new URL(page.url()).searchParams.get('id')
  expect(id).toBeTruthy()
  return id!
}

async function issueInvoice(page: Page, customer: RegExp, issueDate?: string): Promise<void> {
  await page.goto('/invoices/new')
  await page.getByRole('combobox', { name: 'Klant' }).click()
  await page.getByRole('option', { name: customer }).click()
  if (issueDate !== undefined) {
    await page.getByLabel('Factuurdatum').fill(issueDate)
  }
  await page.getByLabel('Omschrijving regel 1').fill('Advies')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Eenheid regel 1').fill('EA')
  await page.getByLabel('Prijs regel 1').fill('250,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('heading', { name: /Factuur \d{4}-/ })).toBeVisible()
}

async function issueInvoiceForBankMatch(page: Page, customerName: string): Promise<void> {
  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByRole('combobox', { name: 'Klant' }).click()
  await page.getByRole('option', { name: customerName }).click()
  await page.getByLabel('Referentie klant').fill('KP-1')
  await page.getByLabel('Omschrijving regel 1').fill('Advieswerk')
  await page.getByLabel('Prijs regel 1').fill('1000,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('link', { name: 'boeking', exact: true })).toBeVisible()
}

async function matchIncomingPayment(page: Page, customerName: string): Promise<void> {
  await page.goto('/bank/match')
  await expect(page.getByRole('heading', { name: 'Bank' })).toBeVisible()
  await hydrated(page)
  const suggestion = page.getByText(/staat in de omschrijving en het bedrag klopt precies/)
  for (let step = 0; step < 4 && !(await suggestion.isVisible()); step += 1) {
    await page.keyboard.press('ArrowDown')
    await suggestion.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined)
  }
  await expect(suggestion).toBeVisible()
  await page.keyboard.press('2')
  await expect(page.getByText(`Geboekt: ${customerName}`)).toBeVisible()
}

async function shoot(
  page: Page,
  name: string,
  size: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(size)
  await page.waitForTimeout(200)
  const png = await page.screenshot({ fullPage: false })
  writeFileSync(join(OUT, name), withPngSourceChunk(png, SCREENSHOT_SOURCE))
}

async function shootPhoneContactCard(
  page: Page,
  contactId: string,
  theme: 'light' | 'dark',
  fileName: string,
): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/contacts/${contactId}`)
  await setTheme(page, theme)
  await expect(page.getByRole('complementary', { name: 'Relatiekaart' })).toBeVisible({
    timeout: 15_000,
  })
  await shoot(page, fileName, { width: 390, height: 844 })
}

test('01 not-yet-due open invoice — desktop 1440 + phone 390 light/dark', async ({ page }) => {
  await openAdmin(page)
  await seedEntityForSales(page)
  const contactId = await seedCustomer(page, 'DEB-1950', 'Klif Demo Relaties')
  await issueInvoice(page, /Klif Demo Relaties/)

  for (const theme of ['light', 'dark'] as const) {
    await persistThemeCookie(page, theme)
    await page.setViewportSize({ width: 1440, height: 1040 })
    await page.goto('/contacts')
    await setTheme(page, theme)
    await hydrated(page)
    await page.getByRole('button', { name: /Klif Demo Relaties/ }).click()
    const card = page.getByRole('complementary', { name: 'Relatiekaart' })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.getByText(/Vervalt/i)).toBeVisible()
    await shoot(page, `01-contacts-open-not-due-${theme}-desktop-1440.png`, {
      width: 1440,
      height: 1040,
    })

    await shootPhoneContactCard(
      page,
      contactId,
      theme,
      `01-contacts-open-not-due-${theme}-mobile-390.png`,
    )
  }
})

test('02 overdue invoice — phone 390 light/dark', async ({ page }) => {
  await openAdmin(page)
  await seedEntityForSales(page)
  const contactId = await seedCustomer(page, 'DEB-1951', 'Klif Te Laat Scherm')
  await issueInvoice(page, /Klif Te Laat Scherm/, addCalendarDays(todayInAmsterdam(), -45))

  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/contacts/${contactId}`)
    await setTheme(page, theme)
    const card = page.getByRole('complementary', { name: 'Relatiekaart' })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.getByText(/dagen te laat|dag te laat/i)).toBeVisible()
    await expect(card.locator('[data-contact-open-amount]')).toHaveClass(/text-destructive/)
    await shoot(page, `02-contacts-overdue-${theme}-mobile-390.png`, {
      width: 390,
      height: 844,
    })
  }
})

test('03 fully paid customer — phone 390 light/dark', async ({ page }) => {
  const paidName = 'Grote Klant N.V.'
  await openAdmin(page)
  await seedEntityForSales(page)
  await importBankStatement(page)
  const contactId = await seedCustomer(page, 'DEB-1952', paidName)
  await issueInvoiceForBankMatch(page, paidName)
  await matchIncomingPayment(page, paidName)

  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/contacts/${contactId}`)
    await setTheme(page, theme)
    const card = page.getByRole('complementary', { name: 'Relatiekaart' })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.getByText(/Nog open/i)).toBeVisible()
    await expect(card.locator('[data-contact-open-amount]')).not.toHaveClass(/text-destructive/)
    await shoot(page, `03-contacts-paid-${theme}-mobile-390.png`, {
      width: 390,
      height: 844,
    })
  }
})
