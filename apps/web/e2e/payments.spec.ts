import { rmSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { createDatabase, closeDatabase, runMigrations } from '@klopt/db'
import { findUserIdByEmail } from '@klopt/db/testing'
import { chooseOption, DATABASE_URL, OUTBOX, signIn, uniqueEmail } from './support'

/**
 * The two-person payment flow, in a browser.
 *
 * This needs two real people in two real browser contexts, because the whole
 * control is about identity. It is also the test that would catch the thing
 * most likely to go wrong in the UI: an approve button offered to the person
 * who submitted, which fails when pressed and teaches nothing.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  rmSync(OUTBOX, { recursive: true, force: true })
})

async function anAdministrationWithAnAccount(page: Page, name: string): Promise<string> {
  const email = uniqueEmail()
  await page.goto('/sign-in')
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByLabel('Naam', { exact: true }).fill('Rekening-courant')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL02ABNA0123456789')).toBeVisible()

  return email
}

test('one person prepares, another approves, and the file comes out', async ({ browser }) => {
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })

  const alice = await browser.newContext()
  const bob = await browser.newContext()

  try {
    const alicePage = await alice.newPage()
    await anAdministrationWithAnAccount(alicePage, 'Fiat BV')

    // Bob signs in and is invited as an accountant, who may approve.
    const bobPage = await bob.newPage()
    const bobEmail = uniqueEmail()
    await bobPage.goto('/sign-in')
    await signIn(bobPage, bobEmail)
    await expect(bobPage.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

    await alicePage.goto('/members')
    const invite = alicePage.locator('form', {
      has: alicePage.getByRole('button', { name: 'Uitnodigen' }),
    })
    await invite.getByLabel('E-mail').fill(bobEmail)
    await chooseOption(alicePage, 'Rol', 'Accountant', invite)
    await alicePage.getByRole('button', { name: 'Uitnodigen' }).click()
    await expect(alicePage.getByText(new RegExp(`${bobEmail} heeft nu toegang`))).toBeVisible()

    // Alice builds a batch.
    await alicePage.goto('/payments')
    await alicePage.getByRole('button', { name: 'Nieuwe batch' }).click()
    await alicePage.getByLabel('Kenmerk').fill('BETAAL-0001')
    await alicePage.getByRole('button', { name: 'Aanmaken' }).click()

    await expect(alicePage.getByRole('heading', { name: /Betaalbatch BETAAL-0001/ })).toBeVisible()
    // An empty batch cannot be offered: it pays nobody.
    await expect(alicePage.getByRole('button', { name: 'Ter fiattering aanbieden' })).toBeDisabled()

    await alicePage.getByRole('button', { name: 'Betaling toevoegen' }).click()
    await alicePage.getByLabel('Begunstigde').fill('Telecom B.V.')
    await alicePage.getByLabel('IBAN').fill('NL20INGB0001234567')
    await alicePage.getByLabel('Bedrag', { exact: true }).fill('45,50')
    await alicePage.getByLabel('Eigen kenmerk').fill('INK-2026-0007')
    await alicePage.getByLabel('Omschrijving').fill('Abonnement maart')
    await alicePage.getByRole('button', { name: 'Toevoegen' }).click()

    await expect(alicePage.getByRole('cell', { name: 'Telecom B.V.' })).toBeVisible()
    await expect(alicePage.getByText('45,50').first()).toBeVisible()

    await alicePage.getByRole('button', { name: 'Ter fiattering aanbieden' }).click()
    await expect(alicePage.getByText(/Status is nu: wacht op fiat/)).toBeVisible()

    // Alice is not offered the approval, and is told why rather than finding out.
    await expect(alicePage.getByRole('button', { name: 'Fiatteren' })).toHaveCount(0)
    await expect(alicePage.getByText(/iemand anders moet hem fiatteren/)).toBeVisible()
    // And the batch is frozen.
    await expect(alicePage.getByRole('button', { name: 'Betaling toevoegen' })).toHaveCount(0)

    // Bob was invited by address and signed in before the invitation existed,
    // so it was claimed at his *next* sign-in — which has not happened. The
    // invitation being immediate for an address that already has an account is
    // exactly why the notice said "heeft nu toegang".
    expect(await findUserIdByEmail(database, bobEmail)).not.toBeNull()

    await bobPage.goto('/payments')
    await expect(bobPage.getByRole('cell', { name: 'BETAAL-0001' })).toBeVisible()
    await bobPage.getByRole('cell', { name: 'BETAAL-0001' }).click()

    await expect(bobPage.getByRole('heading', { name: /Betaalbatch BETAAL-0001/ })).toBeVisible()
    await bobPage.getByRole('button', { name: 'Fiatteren' }).click()
    await expect(bobPage.getByText(/Status is nu: gefiatteerd/)).toBeVisible()

    // And the file really comes out, as XML.
    const url = bobPage.url()
    const batchId = url.split('/').pop() ?? ''
    const file = await bobPage.request.get(`/api/v1/payment-batches/${batchId}/pain001`)
    expect(file.status()).toBe(200)
    const xml = await file.text()
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.001.001.03')
    expect(xml).toContain('<CtrlSum>45.50</CtrlSum>')
    expect(xml).toContain('<IBAN>NL20INGB0001234567</IBAN>')
  } finally {
    await alice.close()
    await bob.close()
    await closeDatabase(database)
  }
})

test('a bad IBAN stops the batch before anybody is asked to approve', async ({ page }) => {
  await anAdministrationWithAnAccount(page, 'Fout IBAN BV')

  await page.goto('/payments')
  await page.getByRole('button', { name: 'Nieuwe batch' }).click()
  await page.getByLabel('Kenmerk').fill('BETAAL-FOUT')
  await page.getByRole('button', { name: 'Aanmaken' }).click()
  await expect(page.getByRole('heading', { name: /Betaalbatch BETAAL-FOUT/ })).toBeVisible()

  await page.getByRole('button', { name: 'Betaling toevoegen' }).click()
  await page.getByLabel('Begunstigde').fill('Fout B.V.')
  // A transposed check digit. The bank would reject the whole batch for it.
  await page.getByLabel('IBAN').fill('NL91ABNA0417164301')
  await page.getByLabel('Bedrag', { exact: true }).fill('10,00')
  await page.getByLabel('Eigen kenmerk').fill('INK-FOUT')
  await page.getByRole('button', { name: 'Toevoegen' }).click()

  // In Dutch, because the browser is: the finding says this in English and
  // the page translates it from the message key (ADR 0047).
  await expect(page.getByRole('alert')).toContainText('geen geldig IBAN')
  await expect(page.getByRole('button', { name: 'Ter fiattering aanbieden' })).toBeDisabled()
})
