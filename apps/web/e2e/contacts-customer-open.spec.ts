import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

/**
 * Customer open on contacts list + card (#195 item 1).
 * Issued, not-yet-due invoice → real open amount and muted "Vervalt …" on the row.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function openAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Open Debiteur Kaart BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
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

async function seedCustomer(page: Page): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-1951')
  await page.getByLabel('Naam', { exact: true }).fill('Klif Demo Relaties')
  await page.getByLabel('E-mail').fill('facturen@example.nl')
  await page.getByLabel('Straat').fill('Demoweg')
  await page.getByLabel('Huisnr.').fill('10')
  await page.getByLabel('Postcode').fill('1000 AA')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Klif Demo Relaties/ })).toBeVisible()
}

async function issueInvoice(page: Page): Promise<void> {
  await page.goto('/invoices/new')
  await page.getByRole('combobox', { name: 'Klant' }).click()
  await page.getByRole('option', { name: /Klif Demo Relaties/ }).click()
  await page.getByLabel('Omschrijving regel 1').fill('Advies')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Eenheid regel 1').fill('EA')
  await page.getByLabel('Prijs regel 1').fill('250,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('heading', { name: /Factuur \d{4}-/ })).toBeVisible()
}

test('contacts list and phone card show open total and Vervalt for not-yet-due invoice', async ({
  page,
}) => {
  await openAdmin(page)
  await seedEntityForSales(page)
  await seedCustomer(page)
  await issueInvoice(page)

  await page.setViewportSize({ width: 1440, height: 1040 })
  await page.goto('/contacts')
  await hydrated(page)
  await page.getByRole('button', { name: /Klif Demo Relaties/ }).click()

  const card = page.getByRole('complementary', { name: 'Relatiekaart' })
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card).toContainText('Nog open')
  await expect(card).toContainText('€')
  await expect(card).not.toContainText('Nog open € 0,00')
  await expect(card.getByText(/Vervalt/i)).toBeVisible()
  await expect(card.getByText(/Open €\s*302,50/i)).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  const id = new URL(page.url()).searchParams.get('id')
  expect(id).toBeTruthy()
  await page.goto(`/contacts/${id}`)
  const phoneCard = page.getByRole('complementary', { name: 'Relatiekaart' })
  await expect(phoneCard.getByText(/Vervalt/i)).toBeVisible()
  await expect(phoneCard.getByText(/Open €\s*302,50/i)).toBeVisible()
})
