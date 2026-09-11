import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { chooseOption, DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Wie wat deed, in a browser.
 *
 * The claim only a browser can check: that somebody who did something can find
 * it afterwards without being handed a database. The screen exists so the log
 * is read before an inspection rather than for the first time during one.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

/**
 * Change a setting, and wait until it really is changed.
 *
 * The Opslaan button is disabled until React has taken over, so clicking it
 * straight after a `goto` does nothing at all — and an audit assertion that
 * follows would be asserting about an action that never happened.
 */
async function aSettingsChange(page: Page): Promise<void> {
  await page.goto('/settings')
  const save = page.getByRole('button', { name: 'Opslaan' })
  await expect(save).toBeEnabled()

  await chooseOption(page, 'Btw-afronding', 'Per regel')
  await save.click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()
}

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Sporen BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('a correction leaves a trail with both sides on it', async ({ page }) => {
  await anAdministration(page)

  await page.goto('/contacts')
  const create = page.getByRole('button', { name: 'Nieuwe relatie' })
  await expect(create).toBeEnabled()
  await create.click()
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Leverancier B.V.')
  await page.getByLabel('IBAN').fill('NL02ABNA012345678')
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()

  await page.getByRole('link', { name: 'Leverancier B.V.' }).click()

  // Every field on the edit form is React-controlled, so filling one before
  // hydration is discarded — and the save would then record no change at all,
  // which is a passing-looking test asserting nothing.
  const save = page.getByRole('button', { name: 'Opslaan' })
  await expect(save).toBeEnabled()
  await expect(page.getByLabel('IBAN')).toHaveValue('NL02ABNA012345678')

  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await save.click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()

  await page.goto('/audit-log')
  await expect(page.getByRole('heading', { name: 'Wie wat deed' })).toBeVisible()

  const row = page.locator('li', { has: page.getByText('sales.updateContact') }).first()
  await expect(row).toBeVisible()

  // Both sides, which is the useful part: "the IBAN went from one to the other"
  // rather than "a request happened".
  await row.getByRole('button', { name: 'Wat er veranderde' }).click()
  await expect(row.getByText('NL02ABNA012345678"')).toBeVisible()
  await expect(row.getByText('NL02ABNA0123456789')).toBeVisible()
})

test('the log filters to one kind of thing', async ({ page }) => {
  await anAdministration(page)

  await aSettingsChange(page)

  await page.goto('/audit-log')
  await expect(page.getByText('setup.updateEntity')).toBeVisible()

  await page.getByRole('button', { name: 'Relaties' }).click()
  await expect(page.getByText('Nog niets vastgelegd.')).toBeVisible()

  await page.getByRole('button', { name: 'Instellingen' }).click()
  await expect(page.getByText('setup.updateEntity')).toBeVisible()
})

test('the export downloads as a file', async ({ page }) => {
  await anAdministration(page)

  await aSettingsChange(page)
  await page.goto('/audit-log')

  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Exporteren' }).click()
  const file = await download

  expect(file.suggestedFilename()).toMatch(/^auditlog-.*\.csv$/)
})
