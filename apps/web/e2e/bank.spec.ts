import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, OUTBOX, signIn, uniqueEmail } from './support'

/**
 * Statement import, in a browser.
 *
 * The two-step import is the thing worth exercising here: pick a file, read
 * what it would do, then confirm. Its failure mode is "the file was accepted
 * and nothing appeared", which no handler test can see.
 */

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'core',
  'test',
  'bank',
  '__fixtures__',
)

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

test('a bookkeeper adds an account, previews a statement and reads it in', async ({ page }) => {
  await anAdministration(page, 'Bank BV')

  await page.getByRole('link', { name: /^Bank/ }).click()
  await expect(page.getByRole('heading', { name: 'Bank' })).toBeVisible()
  await expect(page.getByText(/Nog geen bankrekening/)).toBeVisible()

  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByLabel('Naam', { exact: true }).fill('Rekening-courant')
  await page.getByRole('button', { name: 'Opslaan' }).click()

  await expect(page.getByText('NL02ABNA0123456789')).toBeVisible()
  await expect(page.getByText('nog geen afschrift')).toBeVisible()

  // Pick the file. Nothing is written yet — this is the preview.
  // Enabled first: the input is `disabled` until React has taken over, and
  // setting files on a disabled input silently does nothing.
  await expect(page.locator('input[type="file"]')).toBeEnabled()
  await page.setInputFiles('input[type="file"]', join(FIXTURES, 'statement.mt940'))

  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await expect(page.getByText('mt940')).toBeVisible()
  await expect(page.getByText('01-03-2026 – 05-03-2026')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Banktransacties' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Inlezen', exact: true }).click()

  await expect(page.getByText('4 transacties ingelezen.')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Grote Klant N.V.' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Factuur 2026-0001' })).toBeVisible()
  // Signed the right way round: a receipt is positive, a direct debit is not.
  await expect(page.getByText('1.210,00').first()).toBeVisible()
  await expect(page.getByText('-45,50')).toBeVisible()

  // The same file again adds nothing, and says so.
  // Enabled first: the input is `disabled` until React has taken over, and
  // setting files on a disabled input silently does nothing.
  await expect(page.locator('input[type="file"]')).toBeEnabled()
  await page.setInputFiles('input[type="file"]', join(FIXTURES, 'statement.mt940'))
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  const report = page.locator('dl', { has: page.getByText('Al ingelezen') })
  await expect(report).toContainText('4')
  // Nothing new, so there is nothing to confirm.
  await expect(page.getByRole('button', { name: 'Inlezen', exact: true })).toBeDisabled()
})

test('a file for the wrong account is refused, in words', async ({ page }) => {
  await anAdministration(page, 'Verkeerde Rekening BV')

  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL91RABO0315273637')
  await page.getByLabel('Naam', { exact: true }).fill('Spaarrekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL91RABO0315273637')).toBeVisible()

  // Enabled first: the input is `disabled` until React has taken over, and
  // setting files on a disabled input silently does nothing.
  await expect(page.locator('input[type="file"]')).toBeEnabled()

  await page.setInputFiles('input[type="file"]', join(FIXTURES, 'statement.mt940'))

  await expect(page.getByRole('alert')).toContainText('NL02ABNA0123456789')
  // And no preview to confirm, because there is nothing safe to do with it.
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toHaveCount(0)
})

test('a CSV is mapped once and remembered', async ({ page }) => {
  await anAdministration(page, 'CSV BV')

  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByLabel('Naam', { exact: true }).fill('Rekening-courant')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL02ABNA0123456789')).toBeVisible()

  // Enabled first: the input is `disabled` until React has taken over, and
  // setting files on a disabled input silently does nothing.
  await expect(page.locator('input[type="file"]')).toBeEnabled()

  await page.setInputFiles('input[type="file"]', join(FIXTURES, 'ing.csv'))

  // A CSV has no self-describing layout, so the first import asks — with a
  // guess to correct rather than eleven empty fields.
  await expect(page.getByRole('heading', { name: 'Kolommen van dit bestand' })).toBeVisible()
  // The trigger shows the chosen column, so this reads the text rather than a
  // value. The optional fields carry "(optioneel)" in their accessible name.
  await expect(page.getByLabel('Datum', { exact: true })).toHaveText('Datum')
  await expect(page.getByLabel('Bedrag', { exact: true })).toHaveText('Bedrag (EUR)')
  await expect(page.getByLabel('Af/bij-kolom (optioneel)')).toHaveText('Af Bij')
  await expect(page.getByLabel('Datumnotatie')).toHaveText('yyyyMMdd')
  await expect(page.getByText(/Niet toegewezen/)).toBeVisible()

  await page.getByRole('button', { name: 'Bestand lezen' }).click()

  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await expect(page.getByText('csv', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Inlezen', exact: true }).click()

  await expect(page.getByText('3 transacties ingelezen.')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Grote Klant N.V.' })).toBeVisible()
  // The indicator column decided the signs, not a minus that was never there.
  await expect(page.getByText('1.210,00').first()).toBeVisible()
  await expect(page.getByText('-45,50')).toBeVisible()

  // The second file needs no mapping at all: the account remembers.
  // Enabled first: the input is `disabled` until React has taken over, and
  // setting files on a disabled input silently does nothing.
  await expect(page.locator('input[type="file"]')).toBeEnabled()
  await page.setInputFiles('input[type="file"]', join(FIXTURES, 'ing.csv'))
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kolommen van dit bestand' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Inlezen', exact: true })).toBeDisabled()
})
