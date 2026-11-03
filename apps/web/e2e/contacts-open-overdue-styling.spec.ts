import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

/**
 * #195 item 1 — open amount ink by default; red only when contact has overdue sales (lateDays > 0).
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

function isoDaysAgo(days: number): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - days)
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function openAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Open Kleur Test BV')
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

async function seedCustomer(page: Page, number: string, name: string): Promise<void> {
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
  await page.getByLabel('Prijs regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('heading', { name: /Factuur \d{4}-/ })).toBeVisible()
}

test('not-yet-due open amount is not red on list or card; overdue is red with te-laat badge', async ({
  page,
}) => {
  await openAdmin(page)
  await seedEntityForSales(page)
  await seedCustomer(page, 'DEB-1952', 'Windvaan Open Kleur')
  await issueInvoice(page, /Windvaan Open Kleur/)

  await page.setViewportSize({ width: 1440, height: 1040 })
  await page.goto('/contacts')
  await hydrated(page)
  await page.getByRole('button', { name: /Windvaan Open Kleur/ }).click()

  const card = page.getByRole('complementary', { name: 'Relatiekaart' })
  await expect(card).toBeVisible()
  const cardOpen = card.locator('[data-contact-open-amount]')
  await expect(cardOpen).toHaveAttribute('data-contact-open-overdue', 'false')
  await expect(cardOpen).not.toHaveClass(/text-destructive/)

  const listRow = page.getByRole('button', { name: /Windvaan Open Kleur/ })
  const listOpen = listRow.locator('[data-contacts-list-open-amount]:visible')
  await expect(listOpen).toHaveAttribute('data-contacts-open-overdue', 'false')
  await expect(listOpen).not.toHaveClass(/text-destructive/)
  await expect(listRow.getByText(/dagen te laat|dag te laat/i)).toHaveCount(0)

  await seedCustomer(page, 'DEB-1953', 'Klif Te Laat Demo')
  await issueInvoice(page, /Klif Te Laat Demo/, isoDaysAgo(45))

  await page.goto('/contacts')
  await hydrated(page)
  await page.getByRole('button', { name: /Klif Te Laat Demo/ }).click()
  const overdueCard = page.getByRole('complementary', { name: 'Relatiekaart' })
  await expect(overdueCard.locator('[data-contact-open-amount]')).toHaveAttribute(
    'data-contact-open-overdue',
    'true',
  )
  await expect(overdueCard.locator('[data-contact-open-amount]')).toHaveClass(/text-destructive/)

  const overdueRow = page.getByRole('button', { name: /Klif Te Laat Demo/ })
  const overdueListOpen = overdueRow.locator('[data-contacts-list-open-amount]:visible')
  await expect(overdueListOpen).toHaveAttribute('data-contacts-open-overdue', 'true')
  await expect(overdueListOpen).toHaveClass(/text-destructive/)
  await expect(overdueCard.getByText(/dagen te laat|dag te laat/i)).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/contacts')
  await expect(page.getByRole('button', { name: /Klif Te Laat Demo/ })).toBeVisible()
  const overdueRowMobile = page.getByRole('button', { name: /Klif Te Laat Demo/ })
  await expect(overdueRowMobile.getByText(/dagen te laat|dag te laat/i)).toBeVisible()
  const mobileOpen = overdueRowMobile.locator('[data-contacts-list-open-amount]:visible')
  await expect(mobileOpen).toHaveAttribute('data-contacts-open-overdue', 'true')
  await expect(mobileOpen).toHaveClass(/text-destructive/)
})
