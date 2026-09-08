import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Bewaarplicht, in a browser.
 *
 * The claim only a browser can check: that the destructive button is out of
 * reach until somebody has selected something deletable *and* typed a reason,
 * and that the screen says what the storage guarantees rather than implying it.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Bewaren BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

/** A document in the postvak, which is evidence for nothing yet. */
async function anUploadedDocument(page: Page): Promise<void> {
  await page.goto('/inbox')
  // The file input is disabled until React has taken over, and setting files on
  // a disabled input silently does nothing.
  const input = page.locator('input[type="file"]')
  await expect(input).toBeEnabled()
  await input.setInputFiles({
    name: 'bonnetje.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.7 bonnetje ${crypto.randomUUID()}`, 'utf8'),
  })
  await expect(page.getByText('bonnetje.pdf')).toBeVisible()
}

test('an undated document is shown as undeletable, with the reason', async ({ page }) => {
  await anAdministration(page)
  await anUploadedDocument(page)

  await page.goto('/retention')
  await expect(page.getByRole('heading', { name: 'Bewaarplicht' })).toBeVisible()

  const table = page.getByRole('table', { name: 'Documenten en hun bewaartermijn' })
  await expect(table).toContainText('bonnetje.pdf')
  await expect(table).toContainText('geen boekjaar')
  // Not knowing how long to keep something is not a licence to throw it away.
  await expect(table).toContainText('not a licence to throw it away')
})

test('the delete button stays out of reach until it would be legal', async ({ page }) => {
  await anAdministration(page)
  await anUploadedDocument(page)
  await page.goto('/retention')

  const remove = page.getByRole('button', { name: /Definitief verwijderen/ })
  await expect(remove).toBeDisabled()

  // Selecting is not enough: the document is undated, so nothing is deletable.
  await page.getByRole('checkbox', { name: /Selecteer bonnetje.pdf/ }).check()
  await page.getByLabel(/Reden/).fill('Opruimen')
  await expect(remove).toBeDisabled()
  await expect(remove).toContainText('(0)')

  // Holding it, on the other hand, is allowed and is what somebody would mean.
  await page.getByRole('button', { name: 'Op hold zetten' }).click()
  await expect(page.getByRole('table', { name: 'Documenten en hun bewaartermijn' })).toContainText(
    'legal hold',
  )
})

test('a hold over the administration needs a reason, and shows it', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/retention')

  const set = page.getByRole('button', { name: 'Instellen' })
  await expect(set).toBeEnabled()

  await page.getByLabel('Waarom').fill('Boekenonderzoek Belastingdienst')
  await set.click()

  await expect(page.getByText('Boekenonderzoek Belastingdienst')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Opheffen' })).toBeVisible()

  await page.getByRole('button', { name: 'Opheffen' }).click()
  await expect(page.getByRole('button', { name: 'Instellen' })).toBeVisible()
})

test('the screen says what the storage guarantees', async ({ page }) => {
  // Spec 7.6 asks for object lock. A directory has none, and claiming
  // otherwise on a compliance screen would be the worst kind of wrong.
  await anAdministration(page)
  await page.goto('/retention')

  await expect(page.getByText(/Opslag: filesystem/)).toBeVisible()
  await expect(page.getByText(/geen object lock/)).toBeVisible()
})
