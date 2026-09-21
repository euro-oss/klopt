import { rmSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, OUTBOX, signIn, uniqueEmail } from './support'

/**
 * Invoicing, in a browser, from an empty administration to a posted invoice.
 *
 * This is the M1 promise — "you can invoice for real" — walked end to end, and
 * it is also the regression test for a bug it found: **no screen could write at
 * all**. Every write requires an `Idempotency-Key` (spec 10.2), a browser
 * cannot set that header on a server-function call, and nothing was supplying
 * one. Posting a journal entry, closing a year and issuing an invoice all
 * failed with "Every write needs an Idempotency-Key header" — a failure no
 * handler test could see, because handler tests set the header themselves.
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

test('a bookkeeper records a customer, drafts an invoice and issues it', async ({ page }) => {
  await anAdministration(page, 'Facturen BV')

  await page.getByRole('link', { name: /Relaties/ }).click()
  await expect(page.getByRole('heading', { name: 'Relaties' })).toBeVisible()

  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Grote Klant N.V.')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL987654321B01')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('87654321')
  await page.getByLabel('E-mail').fill('inkoop@groteklant.nl')
  await page.getByLabel('Straat').fill('Coolsingel')
  await page.getByLabel('Huisnr.').fill('42')
  await page.getByLabel('Postcode').fill('3011 AD')
  await page.getByLabel('Plaats').fill('Rotterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()

  await expect(page.getByRole('cell', { name: 'Grote Klant N.V.' })).toBeVisible()

  // Drafting. No number is allocated and nothing is posted yet.
  await page.getByRole('link', { name: /Verkoopfacturen/ }).click()
  await page.getByRole('link', { name: 'Nieuwe factuur' }).click()

  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Referentie klant').fill('KOSTENPLAATS-42')
  await page.getByLabel('Omschrijving regel 1').fill('Advieswerk maart')
  await page.getByLabel('Aantal regel 1').fill('10')
  await page.getByLabel('Eenheid regel 1').fill('HUR')
  await page.getByLabel('Prijs regel 1').fill('100,00')

  // The preview adds up before anything is sent, using integer arithmetic.
  await expect(page.getByText('1.210,00').first()).toBeVisible()

  await page.getByRole('button', { name: 'Concept opslaan' }).click()

  await expect(page.getByRole('heading', { name: /Factuur Concept/ })).toBeVisible()
  await expect(page.getByText(/Dit is een concept/)).toBeVisible()

  // Issuing. This is the write that was impossible before the key was threaded
  // through: it allocates a gapless number and posts to the ledger.
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()

  await expect(
    page.getByRole('heading', { name: /Factuur 2026-0001|Factuur \d{4}-0001/ }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'journaalpost', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'UBL downloaden' })).toBeVisible()

  const invoiceId = page.url().split('/').pop() ?? ''

  /**
   * The two documents, fetched rather than clicked — the assertion is about
   * bytes, not about whether the browser opened a viewer.
   *
   * And they behave differently on purpose. This administration was set up with
   * nothing but a name, so it has no address and no IBAN: the PDF renders
   * anyway, because somebody printing a copy for a customer who wants paper
   * should not be stopped by a Peppol rule, and the UBL is refused because a
   * machine is going to read it.
   */
  const bare = await page.request.get(`/api/v1/sales-invoices/${invoiceId}/pdf`)
  expect(bare.status()).toBe(200)
  expect((await bare.text()).slice(0, 5)).toBe('%PDF-')

  const premature = await page.request.get(`/api/v1/sales-invoices/${invoiceId}/ubl`)
  expect(premature.status()).toBe(422)
  expect(await premature.text()).toContain('NL-R-002')

  // Fill the administration in, and the same invoice becomes sendable.
  await page.goto('/settings')
  await page.getByLabel('Straat').fill('Keizersgracht')
  await page.getByLabel('Huisnummer').fill('123-B')
  await page.getByLabel('Postcode').fill('1015 CJ')
  await page.getByLabel('Plaats').fill('Amsterdam')
  // By role: the e-invoicing scheme select mentions "KvK-nummer" in its options.
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('12345678')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL123456789B01')
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()

  for (const [path, magic] of [
    [`/api/v1/sales-invoices/${invoiceId}/ubl`, '<?xml'],
    [`/api/v1/sales-invoices/${invoiceId}/pdf?embedUbl=true`, '%PDF-'],
  ] as const) {
    const response = await page.request.get(path)
    expect(response.status(), path).toBe(200)
    expect((await response.text()).slice(0, 5)).toBe(magic)
  }

  // Send it. With no SMTP in the test environment the message lands in the
  // outbox directory, and the delivery row says which transport handled it.
  await page.goto(`/invoices/${invoiceId}`)
  await page.getByRole('button', { name: 'Versturen', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Verzonden' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Factuur', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'verzonden', exact: true })).toBeVisible()
  // A second send is offered, not hidden: a customer who lost it asks again.
  await expect(page.getByRole('button', { name: 'Opnieuw versturen' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Versturen en boeken' })).toHaveCount(0)

  // And it really did reach the ledger.
  await page.getByRole('link', { name: 'journaalpost', exact: true }).click()
  await expect(page.getByText('Advieswerk maart').first()).toBeVisible()
})

test('crediting an issued invoice drafts a credit note against it', async ({ page }) => {
  await anAdministration(page, 'Creditnota BV')

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0002')
  await page.getByLabel('Naam', { exact: true }).fill('Spijtige Klant B.V.')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Spijtige Klant B.V.' })).toBeVisible()

  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Referentie klant').fill('X')
  await page.getByLabel('Omschrijving regel 1').fill('Te veel gefactureerd')
  await page.getByLabel('Prijs regel 1').fill('500,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('link', { name: 'journaalpost', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Crediteren' }).click()

  await expect(page.getByRole('heading', { name: /Creditnota Concept/ })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Te veel gefactureerd' })).toBeVisible()
})

test('a posted journal entry goes through, which it could not before', async ({ page }) => {
  await anAdministration(page, 'Memoriaal BV')

  await page.getByRole('link', { name: /Nieuwe journaalpost/ }).click()
  await expect(page.getByRole('button', { name: /Boeken/ }).first()).toBeEnabled()
  await page.getByLabel('Omschrijving', { exact: true }).fill('Openingsbalans')

  await page.getByLabel('Rekening regel 1').fill('1100')
  await page.getByLabel('Debet regel 1').fill('1000,00')
  await page.getByLabel('Rekening regel 2').fill('0500')
  await page.getByLabel('Credit regel 2').fill('1000,00')

  // Posting asks first: the journal is append-only, so the form shows what it is
  // about to write before it writes it (docs/keyboard-map.md, principle 4).
  await page.getByRole('button', { name: 'Boeken', exact: true }).click()
  await page.getByRole('button', { name: 'Definitief boeken' }).click()

  // Not "Every write needs an Idempotency-Key header", which is what this did
  // before the key was threaded through the payload.
  await expect(page.getByText(/Idempotency/)).toHaveCount(0)
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]+$/)
})

test('an overdue invoice turns up in the dunning list and can be chased', async ({ page }) => {
  await anAdministration(page, 'Aanmaning BV')

  await page.goto('/settings')
  await page.getByLabel('Straat').fill('Keizersgracht')
  await page.getByLabel('Huisnummer').fill('1')
  await page.getByLabel('Postcode').fill('1015 CJ')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('12345678')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL123456789B01')
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-LATE')
  await page.getByLabel('Naam', { exact: true }).fill('Trage Betaler B.V.')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('99887766')
  await page.getByLabel('E-mail').fill('crediteuren@tragebetaler.nl')
  await page.getByLabel('Straat').fill('Coolsingel')
  await page.getByLabel('Huisnr.').fill('42')
  await page.getByLabel('Postcode').fill('3011 AD')
  await page.getByLabel('Plaats').fill('Rotterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Trage Betaler B.V.' })).toBeVisible()

  // Dated well in the past, so it is already long overdue.
  await page.goto('/invoices/new')
  // Wait for the form to be live before typing into it: these are controlled
  // inputs, and a value set before hydration is state React never learns about.
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Factuurdatum').fill('2026-01-05')
  await page.getByLabel('Referentie klant').fill('KP-1')
  await page.getByLabel('Omschrijving regel 1').fill('Werk uit januari')
  await page.getByLabel('Prijs regel 1').fill('1000,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('link', { name: 'journaalpost', exact: true })).toBeVisible()

  await page.getByRole('link', { name: /Aanmaningen/ }).click()
  await expect(page.getByRole('heading', { name: 'Aanmaningen' })).toBeVisible()

  const row = page.locator('tbody tr', { has: page.getByText('Trage Betaler B.V.') })
  await expect(row).toBeVisible()
  // Months late, so the schedule says final demand rather than a courtesy.
  await expect(row).toContainText('Laatste aanmaning')

  await row.getByRole('button', { name: 'Versturen' }).click()
  await expect(page.getByText(/verstuurd naar Trage Betaler B.V./)).toBeVisible()

  // Gone from the list: the stage is closed, and it does not come round again.
  await expect(page.locator('tbody tr', { has: page.getByText('Trage Betaler B.V.') })).toHaveCount(
    0,
  )
})

test('a mistyped IBAN can be corrected, which is what makes a supplier payable', async ({
  page,
}) => {
  // The gap this closes: a contact could be created and never fixed, so one
  // wrong character meant a supplier who could never be paid.
  await anAdministration(page, 'Correctie BV')

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Leverancier B.V.')
  await page.getByLabel('IBAN').fill('NL02ABNA012345678')
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()

  await page.getByRole('link', { name: 'Leverancier B.V.' }).click()
  await expect(page.getByRole('heading', { name: /CRE-0001 · Leverancier B.V./ })).toBeVisible()

  // The form opens on what is stored, not on an empty form.
  await expect(page.getByLabel('IBAN')).toHaveValue('NL02ABNA012345678')

  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByLabel('Naam', { exact: true }).fill('Leverancier Nederland B.V.')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()

  await page.goto('/contacts')
  await expect(page.getByRole('link', { name: 'Leverancier Nederland B.V.' })).toBeVisible()

  await page.getByRole('link', { name: 'Leverancier Nederland B.V.' }).click()
  await expect(page.getByLabel('IBAN')).toHaveValue('NL02ABNA0123456789')
})
