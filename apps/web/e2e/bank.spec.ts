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

const EXAMPLE_IBAN = 'NL91ABNA0417164300'
const EXAMPLE_IBAN_DISPLAY = 'NL91 ABNA 0417 1643 00'
/** Different IBAN for the wrong-account case — never the CoS example. */
const OTHER_IBAN = 'NL20INGB0001234567'
const OTHER_IBAN_DISPLAY = 'NL20 INGB 0001 2345 67'

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
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
}

test('a bookkeeper adds an account, previews a statement and reads it in', async ({ page }) => {
  await anAdministration(page, 'Bank BV')

  // Rail "Bank" opens match (#107); statements / accounts live at /bank.
  await page.goto('/bank')
  await expect(page.getByRole('heading', { name: 'Bank' })).toBeVisible()
  await expect(
    page.getByText('Nog geen bankrekening. Voeg er een toe om afschriften te kunnen importeren.'),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill(EXAMPLE_IBAN)
  await page.getByLabel('Naam', { exact: true }).fill('Rekening-courant')
  await page.getByRole('button', { name: 'Opslaan' }).click()

  await expect(page.getByText(EXAMPLE_IBAN_DISPLAY)).toBeVisible()
  await expect(page.getByText('nog geen afschrift')).toBeVisible()

  // CoS: import card only — CAMT/MT940 from your bank; no PSD2 / connection copy.
  // DropZone title and import card share the same heading string — assert one.
  await expect(page.getByText('Bankafschrift importeren').first()).toBeVisible()
  await expect(page.getByText(/CAMT\.053 of MT940 van je bank/)).toBeVisible()
  await expect(page.getByText(/gekoppeld/i)).toHaveCount(0)
  await expect(page.getByText(/PSD2/i)).toHaveCount(0)
  await expect(page.getByText(/live connection/i)).toHaveCount(0)
  await expect(page.getByText(/any Dutch bank/i)).toHaveCount(0)

  // Pick the file. Nothing is written yet — this is the preview.
  // Enabled first: the input is `disabled` until React has taken over, and
  // setting files on a disabled input silently does nothing.
  await expect(page.locator('[data-slot="drop-zone"] input[type="file"]')).toBeEnabled()
  await page.setInputFiles(
    '[data-slot="drop-zone"] input[type="file"]',
    join(FIXTURES, 'statement.mt940'),
  )

  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await expect(page.getByText('mt940', { exact: true })).toBeVisible()
  await expect(page.getByText('01-03-2026 – 05-03-2026')).toBeVisible()
  // Preview only — the list is empty until Import confirms.
  await expect(page.getByText('Nog geen transacties')).toBeVisible()

  await page.getByRole('button', { name: 'Importeren', exact: true }).click()

  await expect(page.getByText('4 transacties geïmporteerd.')).toBeVisible()
  await expect(page.getByText('Grote Klant N.V.')).toBeVisible()
  await expect(page.getByText('Factuur 2026-0001')).toBeVisible()
  // Signed the right way round: a receipt is positive, a direct debit is not.
  await expect(page.getByText('1.210,00').first()).toBeVisible()
  await expect(page.getByText('-45,50')).toBeVisible()

  // The same file again adds nothing, and says so.
  await expect(page.locator('[data-slot="drop-zone"] input[type="file"]')).toBeEnabled()
  await page.setInputFiles(
    '[data-slot="drop-zone"] input[type="file"]',
    join(FIXTURES, 'statement.mt940'),
  )
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  const report = page.locator('dl', { has: page.getByText('Al geïmporteerd') })
  await expect(report).toContainText('4')
  // Nothing new: hide Importeren and say so (PM #171).
  await expect(page.getByRole('button', { name: 'Importeren', exact: true })).toHaveCount(0)
  await expect(page.getByText('Niets nieuw: alle 4 regels stonden er al.')).toBeVisible()
})

test('a file for the wrong account is refused, in words', async ({ page }) => {
  await anAdministration(page, 'Verkeerde Rekening BV')

  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill(OTHER_IBAN)
  await page.getByLabel('Naam', { exact: true }).fill('Spaarrekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText(OTHER_IBAN_DISPLAY)).toBeVisible()

  await expect(page.locator('[data-slot="drop-zone"] input[type="file"]')).toBeEnabled()

  await page.setInputFiles(
    '[data-slot="drop-zone"] input[type="file"]',
    join(FIXTURES, 'statement.mt940'),
  )

  await expect(page.getByRole('alert')).toContainText(EXAMPLE_IBAN)
  // And no preview to confirm, because there is nothing safe to do with it.
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toHaveCount(0)
})

test('a CSV is mapped once and remembered', async ({ page }) => {
  await anAdministration(page, 'CSV BV')

  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill(EXAMPLE_IBAN)
  await page.getByLabel('Naam', { exact: true }).fill('Rekening-courant')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText(EXAMPLE_IBAN_DISPLAY)).toBeVisible()

  await expect(page.locator('[data-slot="drop-zone"] input[type="file"]')).toBeEnabled()

  await page.setInputFiles('[data-slot="drop-zone"] input[type="file"]', join(FIXTURES, 'ing.csv'))

  // A CSV has no self-describing layout, so the first import asks — with a
  // guess to correct rather than eleven empty fields.
  await expect(page.getByRole('heading', { name: 'Kolommen van dit bestand' })).toBeVisible()
  await expect(page.getByLabel('Datum', { exact: true })).toHaveText('Datum')
  await expect(page.getByLabel('Bedrag', { exact: true })).toHaveText('Bedrag (EUR)')
  await expect(page.getByLabel('Af/bij-kolom (optioneel)')).toHaveText('Af Bij')
  await expect(page.getByLabel('Datumnotatie')).toHaveText('yyyyMMdd')
  await expect(page.getByText(/Niet toegewezen/)).toBeVisible()

  await page.getByRole('button', { name: 'Bestand lezen' }).click()

  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await expect(page.getByText('csv', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Importeren', exact: true }).click()

  await expect(page.getByText('3 transacties geïmporteerd.')).toBeVisible()
  await expect(page.getByText('Grote Klant N.V.')).toBeVisible()
  await expect(page.getByText('1.210,00').first()).toBeVisible()
  await expect(page.getByText('-45,50')).toBeVisible()

  await expect(page.locator('[data-slot="drop-zone"] input[type="file"]')).toBeEnabled()
  await page.setInputFiles('[data-slot="drop-zone"] input[type="file"]', join(FIXTURES, 'ing.csv'))
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kolommen van dit bestand' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Importeren', exact: true })).toHaveCount(0)
  await expect(page.getByText(/Niets nieuw: alle \d+ regels stonden er al\./)).toBeVisible()
})
