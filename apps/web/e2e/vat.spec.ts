import { rmSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, OUTBOX, signIn, uniqueEmail } from './support'

/**
 * The BTW-aangifte, in a browser, from an empty administration to a filing.
 *
 * The point of walking it here rather than trusting the handler tests is that
 * the reconciliation is the feature: an operator has to be able to see *why*
 * a rubriek says what it says, and open the journal lines behind it. That is a
 * UI claim, and only a browser can check it.
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

test('an aangifte is derived from the journal, and every rubriek opens to its lines', async ({
  page,
}) => {
  await anAdministration(page, 'BTW BV')

  // One invoice, through the invoice screens: the tagging of the base line is
  // what the whole return depends on, and that happens in the posting code.
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Klant N.V.')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL987654321B01')
  await page.getByLabel('E-mail').fill('inkoop@klant.nl')
  await page.getByLabel('Straat').fill('Coolsingel')
  await page.getByLabel('Huisnr.').fill('42')
  await page.getByLabel('Postcode').fill('3011 AD')
  await page.getByLabel('Plaats').fill('Rotterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Klant N.V.' })).toBeVisible()

  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Factuurdatum').fill('2026-02-10')
  await page.getByLabel('Omschrijving regel 1').fill('Advieswerk februari')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Prijs regel 1').fill('1000,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page.getByRole('heading', { name: /Factuur Concept/ })).toBeVisible()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('link', { name: 'journaalpost', exact: true })).toBeVisible()

  // The aangifte. Nothing was tallied along the way; this is computed now.
  await page.getByRole('link', { name: /BTW/ }).first().click()
  await expect(page.getByRole('heading', { name: 'BTW' })).toBeVisible()
  await expect(page.getByText('per kwartaal')).toBeVisible()

  await page.getByRole('link', { name: '1e kwartaal 2026' }).click()
  await expect(page.getByRole('heading', { name: 'BTW-aangifte 1e kwartaal 2026' })).toBeVisible()

  // 1a carries both the omzet and the btw, and 5c is what has to be paid.
  // Scoped to the aangifte table by its caption: the reconciliation underneath
  // is also a table of rows about the same money.
  const aangifte = page.getByRole('table', { name: 'Rubrieken van de BTW-aangifte' })
  const rubriek1a = aangifte.getByRole('row').filter({ hasText: 'hoog tarief' })
  await expect(rubriek1a).toContainText('1.000,00')
  await expect(rubriek1a).toContainText('210,00')
  await expect(page.getByText('5c Te betalen')).toBeVisible()

  // The reconciliation: the control account agrees with the box. Located by
  // account number rather than name, because the provisioned chart calls 1500
  // "Te betalen omzetbelasting" and a custom chart may call it anything.
  const reconciliation = page.getByRole('table', {
    name: 'Aansluiting van de BTW-rekeningen',
  })
  await expect(reconciliation.getByRole('row').filter({ hasText: '1500' })).toContainText(
    'sluit aan',
  )

  // And the rubriek opens to the journal lines that produced it. This is the
  // spec's "must show, for each rubriek, the exact journal lines".
  await rubriek1a.getByRole('button', { name: '2 regels' }).click()
  const detail = page.getByRole('table', { name: 'Grootboekregels achter rubriek 1a' })
  await expect(detail).toContainText('8000')
  await expect(detail).toContainText('(grondslag)')
  await expect(detail).toContainText('1500')
  await expect(detail).toContainText('(btw)')

  // Filing. A clean return needs no acceptance, and it locks the quarter.
  await page.getByRole('button', { name: /Aangifte indienen en periode vastzetten/ }).click()
  await expect(page.getByText(/Ingediend op/)).toBeVisible()
  await expect(page.getByText(/Deze periode is ingediend/)).toBeVisible()

  // The period list now says so.
  await page.goto('/vat')
  await expect(page.getByRole('row').filter({ hasText: '1e kwartaal 2026' })).toContainText(
    'ingediend',
  )
})

test('a hand-typed movement on a BTW account has to be accepted, with a reason', async ({
  page,
}) => {
  await anAdministration(page, 'Waarschuwing BV')

  // Paying last quarter's aangifte: a legitimate movement on 1500 with no tax
  // code, indistinguishable from VAT booked by hand. The return shows it.
  await page.goto('/entries/new')
  await expect(page.getByRole('button', { name: 'Boeken', exact: true })).toBeEnabled()
  await page.getByLabel('Dagboek').selectOption('BNK')
  await page.getByLabel('Boekdatum').fill('2026-01-31')
  await page.getByLabel('Omschrijving', { exact: true }).fill('Betaling aangifte Q4')
  await page.getByLabel('Rekening regel 1').fill('1500')
  await page.getByLabel('Debet regel 1').fill('180,00')
  await page.getByLabel('Rekening regel 2').fill('1100')
  await page.getByLabel('Credit regel 2').fill('180,00')
  await page.getByRole('button', { name: 'Boeken', exact: true }).click()
  await expect(page.getByRole('heading', { name: /BNK 1/ })).toBeVisible()

  await page.goto('/vat/2026-Q1')
  await expect(page.getByRole('heading', { name: 'BTW-aangifte 1e kwartaal 2026' })).toBeVisible()

  await expect(page.getByText('Mutatie op een BTW-rekening zonder code')).toBeVisible()
  // A warning, not a refusal: the button exists but is not usable until the
  // operator says they have looked.
  const file = page.getByRole('button', { name: /Aangifte indienen/ })
  await expect(file).toBeDisabled()

  await page.getByRole('checkbox').check()
  await page.getByLabel('Waarom').fill('Dit is de betaling van Q4, niet een BTW-boeking.')
  await expect(file).toBeEnabled()
  await file.click()

  await expect(page.getByText(/Ingediend op/)).toBeVisible()
})

test('the ICP opgaaf cross-checks 3b and refuses an unproven VAT number', async ({ page }) => {
  await anAdministration(page, 'ICP BV')

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-EU-1')
  await page.getByLabel('Naam', { exact: true }).fill('Kunde GmbH')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('DE123456789')
  await page.getByLabel('E-mail').fill('einkauf@kunde.de')
  await page.getByLabel('Straat').fill('Hauptstrasse')
  await page.getByLabel('Huisnr.').fill('1')
  await page.getByLabel('Postcode').fill('10115')
  await page.getByLabel('Plaats').fill('Berlin')
  await page.getByLabel('Land').fill('DE')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Kunde GmbH' })).toBeVisible()

  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Klant', { exact: true }).selectOption('DEB-EU-1')
  await page.getByLabel('Factuurdatum').fill('2026-02-20')
  await page.getByLabel('Omschrijving regel 1').fill('Levering naar Duitsland')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Prijs regel 1').fill('1000,00')
  await page.getByLabel('Btw regel 1').selectOption('ICP')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page.getByRole('heading', { name: /Factuur Concept/ })).toBeVisible()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('link', { name: 'journaalpost', exact: true })).toBeVisible()

  // The aangifte declares it in 3b with no VAT.
  await page.goto('/vat/2026-Q1')
  const aangifte = page.getByRole('table', { name: 'Rubrieken van de BTW-aangifte' })
  await expect(aangifte.getByRole('row').filter({ hasText: 'binnen de EU' }).first()).toContainText(
    '1.000,00',
  )

  await page.getByRole('link', { name: 'ICP-opgaaf' }).click()
  await expect(page.getByRole('heading', { name: 'ICP-opgaaf 1e kwartaal 2026' })).toBeVisible()

  // The opgaaf and 3b agree — same lines, two angles.
  await expect(page.getByText('sluit aan')).toBeVisible()
  const row = page.getByRole('row').filter({ hasText: 'DE123456789' })
  await expect(row).toContainText('Kunde GmbH')
  await expect(row).toContainText('1.000,00')

  // And it is still not fileable, because nothing has confirmed the number.
  await expect(row).toContainText('nooit gecontroleerd')
  await expect(page.getByText('Btw-nummer niet bij VIES gecontroleerd')).toBeVisible()

  // A fresh install has no VIES connection, and says so rather than pretending.
  // This is spec 8's rule 1: the default needs no third party, and it is honest
  // about what it therefore cannot prove.
  await page.getByRole('button', { name: /bij VIES controleren/ }).click()
  await expect(page.getByText(/geen VIES-verbinding geconfigureerd/)).toBeVisible()
  await expect(page.getByText('Btw-nummer niet bij VIES gecontroleerd')).toBeVisible()
})
