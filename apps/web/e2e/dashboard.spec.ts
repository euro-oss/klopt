import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * The dashboard as a work queue, in a browser.
 *
 * Everything here is a "the screen did not change" failure, which is what this
 * suite is for: focus that does not land, a row that does not open, a book
 * year that says one thing in the shell and another in the report. None of it
 * is visible to a handler test.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

/** A customer and a saved draft, which is the cheapest row in the queue. */
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

test('an empty administration is told there is nothing waiting, and where to start', async ({
  page,
}) => {
  await anAdministration(page, 'Leeg Bureau BV')

  await expect(page.getByRole('heading', { name: 'Niets wacht' })).toBeVisible()

  // The empty state is a next step rather than a dashed box.
  await page.getByRole('link', { name: 'Verkoopfactuur maken' }).click()
  await expect(page).toHaveURL(/\/invoices\/new$/)
})

test('the queue lists what is waiting and opens the screen where it is done', async ({ page }) => {
  await anAdministration(page, 'Werklijst BV')
  await aDraftInvoice(page)

  await page.goto('/')
  const row = page.getByRole('link', { name: /Concepten om te versturen/ })
  await expect(row).toBeVisible()
  await expect(row).toContainText('1')

  // Focus lands on the first row on its own: the application opens with the
  // hands already on the work.
  await expect(row).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/invoices\?status=draft$/)
})

test('Escape gives the keyboard back to the rest of the application', async ({ page }) => {
  await anAdministration(page, 'Ontsnapping BV')
  await aDraftInvoice(page)

  await page.goto('/')
  const row = page.getByRole('link', { name: /Concepten om te versturen/ })
  await expect(row).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(row).not.toBeFocused()

  // And the global prefixes still work, which is the point of letting go.
  await page.keyboard.press('g')
  await page.keyboard.press('j')
  await expect(page.getByRole('heading', { name: 'Journaalposten' })).toBeVisible()
})

test('the book year in the shell is the administration’s, and the reports agree', async ({
  page,
}) => {
  await anAdministration(page, 'Boekjaar BV')

  const picker = page.getByLabel('Boekjaar')
  await expect(picker).toBeVisible()
  const year = (await picker.textContent())?.trim() ?? ''
  expect(year).toMatch(/^\d{4}/)

  await page.goto('/reports/trial-balance')
  await expect(page.getByText(new RegExp(`Boekjaar ${year.slice(0, 4)}`))).toBeVisible()
})

test('ageing is in the navigation, on both sides', async ({ page }) => {
  await anAdministration(page, 'Ouderdom BV')

  await page.getByRole('link', { name: 'Debiteuren' }).click()
  await expect(page.getByRole('heading', { name: 'Ouderdomsanalyse debiteuren' })).toBeVisible()

  await page.getByRole('link', { name: 'Crediteuren' }).click()
  await expect(page.getByRole('heading', { name: 'Ouderdomsanalyse crediteuren' })).toBeVisible()
})
