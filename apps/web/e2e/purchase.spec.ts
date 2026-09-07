import { rmSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, OUTBOX, signIn, uniqueEmail } from './support'

/**
 * Purchase invoices, in a browser, from a supplier to an approved liability.
 *
 * The claim being checked is the one that only a browser can check: that the
 * screen tells you what disagrees with the document *before* you book, and that
 * it will not let you book something that is not the document. Everything else
 * has handler tests.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  rmSync(OUTBOX, { recursive: true, force: true })
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

async function aSupplier(page: Page): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Leverancier B.V.')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL987654321B01')
  await page.getByLabel('E-mail').fill('facturen@leverancier.test')
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  // The contact has to be marked a supplier, or the purchase form has nobody
  // to offer.
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Leverancier B.V.' })).toBeVisible()
}

/**
 * Waits for the entry form to be interactive.
 *
 * Every control on it is React-controlled, so typing before hydration is
 * discarded and the submit button — correctly — stays disabled. The ƒ button is
 * gated on hydration and nothing else, which makes it the honest thing to wait
 * for.
 */
async function anInteractiveForm(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
}

test('a bookkeeper enters a supplier invoice, books it and gets it approved', async ({ page }) => {
  await anAdministration(page, 'Inkoop BV')
  await aSupplier(page)

  await page
    .getByRole('link', { name: /Inkoopfacturen/ })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'Inkoopfacturen' })).toBeVisible()
  await page.getByRole('link', { name: 'Factuur invoeren' }).click()

  await anInteractiveForm(page)
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeDisabled()

  await page.getByLabel('Factuurnummer leverancier').fill('F-2026-0042')
  await page.getByLabel('Factuurdatum').fill('2026-02-10')
  await page.getByLabel('Vervaldatum').fill('2026-03-12')

  // The figures from the document, typed rather than computed.
  await page.getByLabel('Bedrag excl. btw', { exact: true }).fill('1000,00')
  await page.getByLabel('Btw', { exact: true }).fill('210,00')
  await page.getByLabel('Totaal', { exact: true }).fill('1210,00')

  await page.getByLabel('Omschrijving regel 1').fill('Kantoorartikelen')
  await page.getByLabel('Grootboek regel 1').selectOption('4400')
  await page.getByLabel('Btw-code regel 1').selectOption('VH21')
  await page.getByLabel('Excl. btw regel 1').fill('1000,00')

  // The lines do not add up to the stated VAT yet, and the form says so before
  // anything is saved.
  await expect(page.getByText(/De btw op de regels is niet de btw op het document/)).toBeVisible()

  // The ƒ button fills the VAT from the tax code. On request only: this screen
  // exists to capture the document, not to overwrite it with our arithmetic.
  await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
  await expect(page.getByText(/De btw op de regels is niet de btw op het document/)).toHaveCount(0)

  await page.getByRole('button', { name: 'Concept opslaan' }).click()

  await expect(page.getByRole('heading', { name: 'Inkoopfactuur F-2026-0042' })).toBeVisible()
  await expect(page.getByText('concept')).toBeVisible()

  // Nothing is in the books yet, and it is not payable.
  await expect(page.getByRole('link', { name: /^journaalpost \d/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Boeken', exact: true }).click()
  await expect(page.getByRole('link', { name: /^journaalpost \d/ })).toBeVisible()
  await expect(page.getByText(/nog niet goedgekeurd/)).toBeVisible()

  // The entry is dated the invoice, not today, which is what puts the VAT in
  // the right period.
  await page.getByRole('link', { name: /^journaalpost \d/ }).click()
  await expect(page.getByText('10-02-2026').first()).toBeVisible()
  await expect(page.getByText('Leverancier B.V.').first()).toBeVisible()

  // Approval gates payment, not the ledger.
  await page.goBack()
  await page.getByRole('button', { name: 'Goedkeuren voor betaling' }).click()
  await expect(page.getByText('goedgekeurd voor betaling')).toBeVisible()

  // And rubriek 5b now has the voorbelasting in it.
  await page.goto('/vat/2026-Q1')
  const aangifte = page.getByRole('table', { name: 'Rubrieken van de BTW-aangifte' })
  await expect(aangifte.getByRole('row').filter({ hasText: 'Voorbelasting' })).toContainText(
    '210,00',
  )
})

test('a capture that is not the document cannot be booked', async ({ page }) => {
  await anAdministration(page, 'Bevindingen BV')
  await aSupplier(page)

  await page.goto('/purchases/new')
  await anInteractiveForm(page)
  await page.getByLabel('Factuurnummer leverancier').fill('F-2026-0099')
  await page.getByLabel('Factuurdatum').fill('2026-02-10')
  await page.getByLabel('Vervaldatum').fill('2026-03-12')
  await page.getByLabel('Bedrag excl. btw', { exact: true }).fill('1000,00')
  await page.getByLabel('Btw', { exact: true }).fill('210,00')
  await page.getByLabel('Totaal', { exact: true }).fill('1210,00')

  // Only 900 of the 1000 is coded, which is a line somebody forgot.
  await page.getByLabel('Omschrijving regel 1').fill('Kantoorartikelen')
  await page.getByLabel('Grootboek regel 1').selectOption('4400')
  await page.getByLabel('Excl. btw regel 1').fill('900,00')
  await page.getByLabel('Btw regel 1', { exact: true }).fill('210,00')

  await expect(page.getByText(/De regels tellen op tot een ander bedrag/)).toBeVisible()
  await page.getByRole('button', { name: 'Concept opslaan' }).click()

  await expect(page.getByRole('heading', { name: 'Inkoopfactuur F-2026-0099' })).toBeVisible()
  // Saved, because a draft you cannot save is a draft you retype — and
  // refused for booking, because what is in the system is not the document.
  await expect(page.getByText(/Regels tellen niet op tot het bedrag op de factuur/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Boeken', exact: true })).toBeDisabled()
})

test('the same invoice number from the same supplier is refused', async ({ page }) => {
  await anAdministration(page, 'Dubbel BV')
  await aSupplier(page)

  async function enter(number: string) {
    await page.goto('/purchases/new')
    await anInteractiveForm(page)
    await page.getByLabel('Factuurnummer leverancier').fill(number)
    await page.getByLabel('Factuurdatum').fill('2026-02-10')
    await page.getByLabel('Vervaldatum').fill('2026-03-12')
    await page.getByLabel('Bedrag excl. btw', { exact: true }).fill('100,00')
    await page.getByLabel('Btw', { exact: true }).fill('21,00')
    await page.getByLabel('Totaal', { exact: true }).fill('121,00')
    await page.getByLabel('Omschrijving regel 1').fill('Iets')
    await page.getByLabel('Grootboek regel 1').selectOption('4400')
    await page.getByLabel('Excl. btw regel 1').fill('100,00')
    await page.getByLabel('Btw regel 1', { exact: true }).fill('21,00')
    await page.getByRole('button', { name: 'Concept opslaan' }).click()
  }

  await enter('F-2026-0100')
  await expect(page.getByRole('heading', { name: 'Inkoopfactuur F-2026-0100' })).toBeVisible()

  // Paying an invoice twice is the classic accounts-payable failure, so the
  // second arrival of the same number is refused rather than saved.
  await enter('F-2026-0100')
  await expect(page.getByText(/has already sent invoice F-2026-0100/)).toBeVisible()
})
