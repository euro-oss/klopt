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
  await page.getByLabel('Btw-nummer').fill('NL987654321B01')
  await page.getByLabel('KvK-nummer').fill('87654321')
  await page.getByLabel('Straat').fill('Coolsingel')
  await page.getByLabel('Huisnr.').fill('42')
  await page.getByLabel('Postcode').fill('3011 AD')
  await page.getByLabel('Plaats').fill('Rotterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()

  await expect(page.getByRole('cell', { name: 'Grote Klant N.V.' })).toBeVisible()

  // Drafting. No number is allocated and nothing is posted yet.
  await page.getByRole('link', { name: /Verkoopfacturen/ }).click()
  await page.getByRole('link', { name: 'Nieuwe factuur' }).click()

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
  await page.getByLabel('Omschrijving', { exact: true }).fill('Openingsbalans')

  await page.getByLabel('Rekening regel 1').fill('1100')
  await page.getByLabel('Debet regel 1').fill('1000,00')
  await page.getByLabel('Rekening regel 2').fill('0500')
  await page.getByLabel('Credit regel 2').fill('1000,00')

  await page
    .getByRole('button', { name: /Boeken/ })
    .first()
    .click()

  // Not "Every write needs an Idempotency-Key header", which is what this did
  // before the key was threaded through the payload.
  await expect(page.getByText(/Idempotency/)).toHaveCount(0)
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]+$/)
})
