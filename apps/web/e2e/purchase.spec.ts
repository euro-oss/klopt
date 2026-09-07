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

/** A UBL invoice from the supplier the tests create. */
const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>F-2026-0042</cbc:ID>
  <cbc:IssueDate>2026-02-10</cbc:IssueDate>
  <cbc:DueDate>2026-03-12</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>Leverancier B.V.</cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme><cbc:CompanyID>NL987654321B01</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">210.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1210.00</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Kantoorartikelen</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
  </cac:InvoiceLine>
</Invoice>`

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

test('a UBL invoice arrives in the postvak and becomes a booked liability', async ({ page }) => {
  await anAdministration(page, 'Postvak BV')
  await aSupplier(page)

  await page
    .getByRole('link', { name: /Postvak/ })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'Postvak' })).toBeVisible()
  await expect(page.getByText('Niets in het postvak.')).toBeVisible()

  // The file input is hidden behind a label, which is what `setInputFiles`
  // wants anyway — it sets the input, not the label.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'inkomende-factuur.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(UBL, 'utf8'),
  })

  // Read on arrival: the number, the amount, and the supplier it was matched
  // to by VAT number.
  await expect(page.getByText('F-2026-0042 · Leverancier B.V.')).toBeVisible()
  await expect(page.getByText('1.210,00', { exact: false }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Verwerken' }).click()

  // The parse parked the line on the tussenrekening and suggested a code. A
  // human confirms both; the amounts are not editable at all.
  await expect(page.getByLabel('Leverancier')).toHaveValue('CRE-0001')
  await page.getByLabel('Grootboek regel 1').selectOption('4400')
  await expect(page.getByLabel('Btw-code regel 1')).toHaveValue('VH21')

  await page.getByRole('button', { name: 'Concept maken' }).click()

  await expect(page.getByRole('heading', { name: 'Inkoopfactuur F-2026-0042' })).toBeVisible()
  await page.getByRole('button', { name: 'Boeken', exact: true }).click()
  await expect(page.getByRole('link', { name: /^journaalpost \d/ })).toBeVisible()

  // And the queue is empty again.
  await page.goto('/inbox')
  await expect(page.getByText('Niets in het postvak.')).toBeVisible()
})

test('the same document arriving twice is one document and two arrivals', async ({ page }) => {
  await anAdministration(page, 'Dubbel postvak BV')
  await aSupplier(page)

  const file = {
    name: 'inkomende-factuur.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(UBL, 'utf8'),
  }

  await page.goto('/inbox')
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect(page.getByText('F-2026-0042 · Leverancier B.V.')).toBeVisible()

  await page.locator('input[type="file"]').setInputFiles(file)
  // Content addressing is what makes this knowable: same bytes, same document.
  await expect(page.getByText(/Dit bestand was er al/)).toBeVisible()
  await expect(page.getByText(/dit bestand was er al/).first()).toBeVisible()
})

test('a document nothing can be read out of is kept, not lost', async ({ page }) => {
  await anAdministration(page, 'PDF postvak BV')

  await page.goto('/inbox')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'reclamefolder.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 dit is geen factuur', 'utf8'),
  })

  await expect(page.getByText('reclamefolder.pdf')).toBeVisible()
  await expect(page.getByText(/kan niets gelezen worden/)).toBeVisible()

  // It can still be opened and set aside with a reason.
  await page.getByRole('button', { name: 'Verwerken' }).click()
  await page.getByLabel('Waarom terzijde?').fill('Reclamefolder, geen factuur.')
  await page.getByRole('button', { name: 'Terzijde leggen' }).click()

  await expect(page.getByText('Niets in het postvak.')).toBeVisible()
  await page.goto('/inbox?state=discarded')
  await expect(page.getByText(/Terzijde gelegd: Reclamefolder/)).toBeVisible()
})

test('an approved invoice becomes a payment instruction', async ({ page }) => {
  // The claim only a browser can check: somebody can see what the run would pay
  // before it is written, and the numbers on that screen are the ones that end
  // up in the batch.
  await anAdministration(page, 'Betaalrun BV')
  await aSupplier(page)

  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL20INGB0001234567')
  await page.getByLabel('Naam', { exact: true }).fill('Rekening-courant')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL20INGB0001234567')).toBeVisible()

  await page.goto('/purchases/new')
  await anInteractiveForm(page)
  await page.getByLabel('Factuurnummer leverancier').fill('F-2026-0042')
  await page.getByLabel('Factuurdatum').fill('2026-02-10')
  await page.getByLabel('Vervaldatum').fill('2026-03-12')
  await page.getByLabel('Bedrag excl. btw', { exact: true }).fill('1000,00')
  await page.getByLabel('Btw', { exact: true }).fill('210,00')
  await page.getByLabel('Totaal', { exact: true }).fill('1210,00')
  await page.getByLabel('Omschrijving regel 1').fill('Kantoorartikelen')
  await page.getByLabel('Grootboek regel 1').selectOption('4400')
  await page.getByLabel('Btw-code regel 1').selectOption('VH21')
  await page.getByLabel('Excl. btw regel 1').fill('1000,00')
  await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
  await page.getByRole('button', { name: 'Concept opslaan' }).click()

  await expect(page.getByRole('heading', { name: 'Inkoopfactuur F-2026-0042' })).toBeVisible()
  await page.getByRole('button', { name: 'Boeken', exact: true }).click()
  await page.getByRole('button', { name: 'Goedkeuren voor betaling' }).click()
  await expect(page.getByText('goedgekeurd voor betaling')).toBeVisible()

  await page.goto('/payments')
  await page.getByRole('button', { name: 'Nieuwe batch' }).click()
  await page.getByLabel('Kenmerk').fill('BETAAL-0002')
  await page.getByRole('button', { name: 'Aanmaken' }).click()
  await expect(page.getByRole('heading', { name: /Betaalbatch BETAAL-0002/ })).toBeVisible()

  // The preview: one beneficiary, the invoice it settles, the amount.
  const preview = page.getByRole('table', { name: 'Wat deze betaalrun zou betalen' })
  await expect(preview).toContainText('Leverancier B.V.')
  await expect(preview).toContainText('F-2026-0042')
  await expect(preview).toContainText('1.210,00')

  await page.getByRole('button', { name: 'Deze betalingen overnemen' }).click()

  // And what the preview said is what the batch holds.
  await expect(page.getByText('NL02ABNA0123456789')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ter fiattering aanbieden' })).toBeEnabled()

  // Scheduling is not paying: the invoice is still owed and still reconciles.
  await page.goto('/reports/creditor-ageing')
  await expect(page.getByText('1.210,00').first()).toBeVisible()
  await expect(page.getByText(/sluit aan|Sluit aan/).first()).toBeVisible()

  // But it is out of the next run.
  await page.goto('/payments')
  await page.getByRole('button', { name: 'Nieuwe batch' }).click()
  await page.getByLabel('Kenmerk').fill('BETAAL-0003')
  await page.getByRole('button', { name: 'Aanmaken' }).click()
  await expect(page.getByRole('heading', { name: /Betaalbatch BETAAL-0003/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Deze betalingen overnemen' })).toHaveCount(0)
})
