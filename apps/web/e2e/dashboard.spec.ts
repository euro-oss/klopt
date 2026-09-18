import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { chooseOption, DATABASE_URL, signIn, uniqueEmail } from './support'

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

  // The control itself, in the chrome rather than on a report.
  await expect(page.getByLabel('Boekjaar')).toBeVisible()

  // Read the year off the dashboard rather than out of the picker: what
  // matters is that the screens agree about it, and a Radix trigger's text is
  // a detail of a component library.
  const heading = (await page.getByText(/^Boekjaar \d{4}:/).textContent()) ?? ''
  const year = /Boekjaar (\d{4})/.exec(heading)?.[1] ?? ''
  expect(year).toMatch(/^\d{4}$/)

  // The dates are shown under the picker, because a boekjaar labelled 2025 may
  // run into 2026 and a label alone is the guess this replaced.
  await expect(page.getByText(/\d{2}-\d{2}-\d{4} – \d{2}-\d{2}-\d{4}/)).toBeVisible()

  await page.goto('/reports/trial-balance')
  await expect(page.getByText(new RegExp(`Boekjaar ${year}`))).toBeVisible()
})

test('a boekjaar that is not the calendar year is the one the screens use', async ({ page }) => {
  // The bug this replaces, as directly as a browser can state it: an
  // administration whose only book year is an earlier one, running July to
  // June. The calendar year is not that year and has no book year at all, so
  // the old `new Date().getFullYear()` asked for a year that does not exist.
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()

  await page.getByLabel('Naam van de administratie').fill('Gebroken Boekjaar BV')
  const opened = String(new Date().getUTCFullYear() - 1)
  await page.getByLabel('Boekjaar').fill(opened)
  await chooseOption(page, 'Begint in', 'juli')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText(`Boekjaar ${opened}:`)).toBeVisible()
  await expect(
    page.getByText(`01-07-${opened} – 30-06-${String(Number(opened) + 1)}`),
  ).toBeVisible()

  await page.goto('/reports/trial-balance')
  await expect(page.getByText(new RegExp(`Boekjaar ${opened}`))).toBeVisible()

  // And a report about open items ages as of the end of that year rather than
  // as of today, which would call everything in it a year late.
  await page.goto('/reports/debtor-ageing')
  await expect(
    page.getByText(new RegExp(`Vervallen verkoopfacturen per 30-06-${String(Number(opened) + 1)}`)),
  ).toBeVisible()
})

test('ageing is in the navigation, on both sides', async ({ page }) => {
  await anAdministration(page, 'Ouderdom BV')

  await page.getByRole('link', { name: 'Debiteuren' }).click()
  await expect(page.getByRole('heading', { name: 'Ouderdomsanalyse debiteuren' })).toBeVisible()

  await page.getByRole('link', { name: 'Crediteuren' }).click()
  await expect(page.getByRole('heading', { name: 'Ouderdomsanalyse crediteuren' })).toBeVisible()
})
