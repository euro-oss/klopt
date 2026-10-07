import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Overzetten uit Moneybird, in a browser (issue #32).
 *
 * Nothing here reaches Moneybird — the token and every read happen on the
 * server. What a browser can check is the part that goes wrong for a human:
 * later steps stay out of the way until there is a connection, and connecting
 * is refused without a token.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Overzetten BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('the Moneybird screen offers only the step that can be done', async ({ page }) => {
  await anAdministration(page)

  await page.getByRole('link', { name: 'Moneybird' }).click()
  await expect(page.getByRole('heading', { name: 'Moneybird' })).toBeVisible()

  await expect(page.getByRole('heading', { name: '1. Verbinden' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '2. Welke administratie' })).toBeHidden()
  await expect(page.getByRole('heading', { name: '3. Proefimport' })).toBeHidden()
})

test('connecting is refused until there is a token', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/moneybird')

  await expect(page.getByLabel('Persoonlijk API-token')).toBeEnabled()
  const button = page.getByRole('button', { name: 'Verbinden met Moneybird' })
  await expect(button).toBeDisabled()

  await page.getByLabel('Persoonlijk API-token').fill('not-a-real-token')
  await expect(button).toBeEnabled()
})

test('i m reaches Moneybird under Importeren', async ({ page }) => {
  await anAdministration(page)

  // Same hydration wait as Exact: the sidebar only prints a chord once the
  // listener is live (#37).
  await expect(page.getByRole('link', { name: /Journaalposten/ }).locator('kbd')).toHaveCount(1)
  await expect(page.getByRole('navigation').getByText('Importeren')).toBeVisible()
  await expect(page.getByRole('link', { name: /Moneybird/ }).locator('kbd')).toContainText(/I/)

  await page.keyboard.press('i')
  await expect(page.getByText('I …')).toBeVisible()
  await page.keyboard.press('m')

  await expect(page.getByRole('heading', { name: 'Moneybird' })).toBeVisible()
})
