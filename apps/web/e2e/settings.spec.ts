import { rmSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, OUTBOX, signIn, uniqueEmail } from './support'

/**
 * The administration's own details, in a browser.
 *
 * These are the fields a UBL invoice cannot be generated without, and the form
 * that fills them in is the one place the setup screen's promise — "de rest kun
 * je later nog wijzigen" — is either kept or quietly broken.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  rmSync(OUTBOX, { recursive: true, force: true })
})

async function anOwner(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('an owner fills in the details an e-invoice needs, and they stick', async ({ page }) => {
  await anOwner(page, 'Instellingen BV')

  await page.getByRole('link', { name: /Instellingen/ }).click()
  await expect(page.getByRole('heading', { name: 'Instellingen' })).toBeVisible()

  await page.getByLabel('Straat').fill('Keizersgracht')
  await page.getByLabel('Huisnummer').fill('123-B')
  await page.getByLabel('Postcode').fill('1015 CJ')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByRole('button', { name: 'Opslaan' }).click()

  await expect(page.getByText('Opgeslagen.')).toBeVisible()

  // Survives a reload, which is the assertion that distinguishes "saved" from
  // "the form still has what you typed in it".
  await page.reload()
  await expect(page.getByLabel('Plaats')).toHaveValue('Amsterdam')
  await expect(page.getByLabel('IBAN')).toHaveValue('NL02ABNA0123456789')
})

test('a bad country code is reported instead of silently dropped', async ({ page }) => {
  await anOwner(page, 'Tweeletter BV')

  await page.goto('/settings')
  // By role and exact: the entity picker's accessible name is the label plus
  // the selected administration, so a substring match on "Land" can hit it.
  await page.getByRole('textbox', { name: 'Land', exact: true }).fill('N')
  await page.getByRole('button', { name: 'Opslaan' }).click()

  // Next to the input that is wrong, not as a generic banner. A validator that
  // throws used to bypass the error path entirely and the form did nothing at
  // all, which is the failure this test exists for.
  await expect(page.getByRole('alert')).toContainText('ISO 3166-1')
  await expect(page.getByRole('textbox', { name: 'Land', exact: true })).toHaveValue('N')
})
