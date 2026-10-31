import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for #107 Phase 2 Sales — Invoices / Reminders / PhoneSales /
 * PhoneInvoice / InvoicesDark.
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=<pr> \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-phase2-sales.spec.ts
 *
 * Seed uses fictional companies, example.nl, and the registry test IBAN only.
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? 'phase2'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
    document.documentElement.dataset['theme'] = value
  }, theme)
}

async function shot(page: Page, name: string, options?: { fullPage?: boolean }): Promise<void> {
  // Blur so Playwright's caret-hide does not leave inline styles that trigger
  // a hydration console.error on the next client render.
  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  })
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    fullPage: options?.fullPage ?? false,
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

/** Sidebar kbd signals are desktop-only; on phone wait for the page chrome. */
async function ready(page: Page, width: number): Promise<void> {
  if (width >= 768) {
    await hydrated(page)
  } else {
    await expect(page.getByRole('heading', { name: /Verkoop|Factuur|Creditnota/ })).toBeVisible()
  }
}

async function setupEntity(page: Page): Promise<string> {
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

  const entityRes = await page.request.get('/api/v1/entity')
  expect(entityRes.ok()).toBeTruthy()
  const entity = (await entityRes.json()) as { id: string }
  return entity.id
}

async function seedContact(page: Page, number: string, name: string, email: string): Promise<void> {
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill(number)
  await page.getByLabel('Naam', { exact: true }).fill(name)
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('87654321')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL987654321B01')
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
  issueDate?: string,
): Promise<string> {
  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByRole('combobox', { name: 'Klant' }).click()
  await page.getByRole('option', { name: new RegExp(customer) }).click()
  if (issueDate !== undefined) {
    await page.getByLabel('Factuurdatum').fill(issueDate)
  }
  await page.getByLabel('Referentie klant').fill(`PO-${customer.slice(0, 8)}`)
  await page.getByLabel('Omschrijving regel 1').fill(description)
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Eenheid regel 1').fill('EA')
  await page.getByLabel('Prijs regel 1').fill(price)
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page.getByRole('heading', { name: /Factuur Concept/ })).toBeVisible()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('heading', { name: /Factuur \d{4}-/ })).toBeVisible()
  const id = new URL(page.url()).pathname.split('/').pop() ?? ''
  await page.getByRole('button', { name: 'Factuur versturen', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Opnieuw versturen', exact: true })).toBeVisible()
  return id
}

async function seedSalesData(page: Page, entityId: string): Promise<void> {
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

  await page.getByRole('link', { name: /Relaties/ }).click()
  const customers = [
    ['DEB-1001', 'Windvaan Workshops', 'windvaan@example.nl'],
    ['DEB-1002', 'Molenaar Media', 'molenaar@example.nl'],
    ['DEB-1003', 'Atelier Noordkust', 'atelier@example.nl'],
    ['DEB-1004', 'Hoveniers De Linden', 'linden@example.nl'],
    ['DEB-1005', 'Drukkerij Westland', 'westland@example.nl'],
    ['DEB-1006', 'Installatie Meijer', 'meijer@example.nl'],
  ] as const
  for (const [number, name, email] of customers) {
    await seedContact(page, number, name, email)
  }

  // Draft (Concepten)
  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByRole('combobox', { name: 'Klant' }).click()
  await page.getByRole('option', { name: /Windvaan Workshops/ }).click()
  await page.getByLabel('Omschrijving regel 1').fill('Concept advies')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Eenheid regel 1').fill('EA')
  await page.getByLabel('Prijs regel 1').fill('40,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page.getByRole('heading', { name: /Factuur Concept/ })).toBeVisible()

  // Five open (current) invoices across customers
  const openJobs = [
    ['Windvaan Workshops', '100,00'],
    ['Molenaar Media', '250,00'],
    ['Atelier Noordkust', '80,00'],
    ['Hoveniers De Linden', '420,00'],
    ['Drukkerij Westland', '175,00'],
  ] as const
  for (const [customer, price] of openJobs) {
    await draftAndIssue(page, customer, `Levering ${price}`, price)
  }

  // Overdue at different stages (backdated issue dates; 30-day terms)
  await draftAndIssue(page, 'Installatie Meijer', 'Achterstallig vroeg', '480,00', daysAgo(50))
  await draftAndIssue(page, 'Hoveniers De Linden', 'Achterstallig laat', '985,00', daysAgo(120))

  // Credit note against one open invoice (preview only after an explicit select).
  await page.goto('/invoices?segment=open')
  await hydrated(page)
  const windvaan = page
    .locator('.md\\:block')
    .getByRole('button', { name: /Windvaan Workshops/ })
    .first()
  await expect(windvaan).toBeVisible()
  await windvaan.click()
  await expect.poll(() => new URL(page.url()).searchParams.get('id')).toBeTruthy()
  const preview = page.getByRole('complementary', { name: 'Factuurvoorbeeld' })
  await expect(preview).toBeVisible()
  await preview.getByRole('button', { name: 'Creditnota' }).click()
  await expect(page.getByRole('heading', { name: /Creditnota Concept/ })).toBeVisible()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('heading', { name: /Creditnota CN\d{4}-/ })).toBeVisible()

  // Cancel one issued invoice via SQL (no cancel UI yet)
  const cancelTarget = await draftAndIssue(page, 'Drukkerij Westland', 'Te annuleren', '60,00')
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const sql = (database as unknown as { $client: SqlTag }).$client
  try {
    await sql`
      update klopt.sales_invoices
      set status = 'cancelled', updated_at = now()
      where id = ${cancelTarget}::uuid
        and entity_id = ${entityId}::uuid
    `
  } finally {
    await closeDatabase(database)
  }
}

function daysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

test('01 empty Sales light/dark 1440 and 390', async ({ page }) => {
  await setupEntity(page)
  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1440, height: 1040 })
    await page.goto('/invoices')
    await ready(page, 1440)
    await setTheme(page, theme)
    await shot(page, `01-sales-empty-${theme}-desktop-1440`)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/invoices')
    await ready(page, 390)
    await setTheme(page, theme)
    await shot(page, `01-sales-empty-${theme}-mobile-390`)
    await shot(page, `01-sales-empty-${theme}-mobile-390-full`, { fullPage: true })

    await page.setViewportSize({ width: 1440, height: 1040 })
    await page.goto('/dunning')
    await ready(page, 1440)
    await setTheme(page, theme)
    await shot(page, `01-reminders-empty-${theme}-desktop-1440`)
  }
})

test('02 seeded Sales + Reminders + phone invoice', async ({ page }) => {
  const entityId = await setupEntity(page)
  await seedSalesData(page, entityId)

  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1440, height: 1040 })
    await page.goto('/invoices?segment=open')
    await ready(page, 1440)
    // Preview opens only with an explicit selection (Escape closes it).
    await page.getByRole('heading', { name: 'Verkoop' }).click()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('complementary', { name: 'Factuurvoorbeeld' })).toBeVisible()
    await setTheme(page, theme)
    await shot(page, `02-sales-data-${theme}-desktop-1440`)

    await page.goto('/invoices?segment=draft')
    await ready(page, 1440)
    await page.getByRole('heading', { name: 'Verkoop' }).click()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('complementary', { name: 'Factuurvoorbeeld' })).toBeVisible()
    await setTheme(page, theme)
    await shot(page, `02-sales-drafts-${theme}-desktop-1440`)

    await page.goto('/invoices?segment=overdue')
    await ready(page, 1440)
    await page.getByRole('heading', { name: 'Verkoop' }).click()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('complementary', { name: 'Factuurvoorbeeld' })).toBeVisible()
    await setTheme(page, theme)
    await shot(page, `02-sales-overdue-${theme}-desktop-1440`)

    await page.goto('/dunning')
    await ready(page, 1440)
    await setTheme(page, theme)
    await shot(page, `02-reminders-${theme}-desktop-1440`)
    // Email preview with Dutch template (complementary is "Voorbeeld")
    await expect(page.getByRole('complementary', { name: 'Voorbeeld' })).toBeVisible()
    await expect(page.getByText('E-mailvoorbeeld')).toBeVisible()
    await shot(page, `02-reminders-preview-${theme}-desktop-1440`)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/invoices?segment=open')
    await ready(page, 390)
    await setTheme(page, theme)
    await shot(page, `02-sales-data-${theme}-mobile-390`)
    await shot(page, `02-sales-data-${theme}-mobile-390-full`, { fullPage: true })

    await page.goto('/invoices?segment=overdue')
    await ready(page, 390)
    await setTheme(page, theme)
    await shot(page, `02-sales-overdue-${theme}-mobile-390`)
    await shot(page, `02-sales-overdue-${theme}-mobile-390-full`, { fullPage: true })

    await page.goto('/dunning')
    await ready(page, 390)
    await setTheme(page, theme)
    await shot(page, `02-reminders-${theme}-mobile-390`)
    await shot(page, `02-reminders-${theme}-mobile-390-full`, { fullPage: true })

    await page.goto('/invoices?segment=overdue')
    await ready(page, 390)
    // Prefer the stage-3 row so PhoneInvoice shows Derde herinnering versturen.
    const overdueLink = page.getByRole('link', { name: /Linden/ }).first()
    await overdueLink.click()
    await expect(page.getByRole('heading', { name: /Linden/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Derde herinnering versturen' })).toBeVisible()
    await setTheme(page, theme)
    await shot(page, `02-invoice-detail-${theme}-mobile-390`)
    await shot(page, `02-invoice-detail-${theme}-mobile-390-full`, { fullPage: true })
  }
})
