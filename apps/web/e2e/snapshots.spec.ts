import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Verzegelde momentopnames, in a browser.
 *
 * The claim only a browser can check: that the seal is on screen in full, that
 * checking one says whether it looked at the auditfile, and that a manifest
 * downloads as plain text somebody can hash themselves.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministrationWithAPosting(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Zegel BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  // A book year with nothing in it has nothing worth sealing.
  await page.getByRole('link', { name: /Nieuwe journaalpost/ }).click()
  const post = page.getByRole('button', { name: /Boeken/ }).first()
  await expect(post).toBeEnabled()

  await page.getByLabel('Omschrijving', { exact: true }).fill('Eerste post')
  await page.getByLabel('Rekening regel 1').fill('4000')
  await page.getByLabel('Debet regel 1').fill('100,00')
  await page.getByLabel('Rekening regel 2').fill('1000')
  await page.getByLabel('Credit regel 2').fill('100,00')
  await post.click()
  // The form asks before it posts; the journal cannot be edited afterwards.
  await page.getByRole('button', { name: 'Definitief boeken' }).click()

  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]+$/)
}

test('sealing a year puts the seal on screen in full', async ({ page }) => {
  await anAdministrationWithAPosting(page)

  await page.goto('/snapshots')
  await expect(page.getByText('Nog geen momentopnames.')).toBeVisible()

  const seal = page.getByRole('button', { name: 'Verzegelen' })
  await expect(seal).toBeEnabled()
  await page.getByLabel('Boekjaar om te verzegelen').fill('2026')
  await seal.click()

  await expect(page.getByRole('heading', { name: 'Boekjaar 2026' })).toBeVisible()

  // In full: 64 hex characters, because this is the value somebody writes down.
  const shown = await page
    .locator('p', { hasText: /^zegel [0-9a-f]{64}$/ })
    .first()
    .innerText()
  expect(shown.replace('zegel ', '').trim()).toMatch(/^[0-9a-f]{64}$/)
})

test('checking one says whether it looked at the auditfile', async ({ page }) => {
  // "Verified" with a check skipped is a lie by omission, so the screen offers
  // both and the cheap one is the default.
  await anAdministrationWithAPosting(page)
  await page.goto('/snapshots')

  await page.getByLabel('Boekjaar om te verzegelen').fill('2026')
  await page.getByRole('button', { name: 'Verzegelen' }).click()
  await expect(page.getByRole('heading', { name: 'Boekjaar 2026' })).toBeVisible()

  await page.getByRole('button', { name: 'Controleren', exact: true }).click()
  await expect(page.getByText(/gecontroleerd op/)).toBeVisible()

  await page.getByRole('button', { name: 'Controleren met auditfile' }).click()
  await expect(page.getByText(/gecontroleerd op/)).toBeVisible()
  await expect(page.getByText('afwijking gevonden')).toHaveCount(0)
})

test('the manifest downloads as text somebody can hash', async ({ page }) => {
  await anAdministrationWithAPosting(page)
  await page.goto('/snapshots')

  await page.getByLabel('Boekjaar om te verzegelen').fill('2026')
  await page.getByRole('button', { name: 'Verzegelen' }).click()
  await expect(page.getByRole('heading', { name: 'Boekjaar 2026' })).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Manifest' }).click()
  const file = await download

  expect(file.suggestedFilename()).toMatch(/^snapshot-2026-[0-9a-f]{12}\.manifest\.txt$/)
})

test('a year with nothing in it is refused, not sealed', async ({ page }) => {
  await anAdministrationWithAPosting(page)
  await page.goto('/snapshots')

  await page.getByLabel('Boekjaar om te verzegelen').fill('2019')
  await page.getByRole('button', { name: 'Verzegelen' }).click()

  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Boekjaar 2019' })).toHaveCount(0)
})
