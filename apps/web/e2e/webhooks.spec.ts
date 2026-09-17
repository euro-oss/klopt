import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Subscribing to the event stream, in a browser (spec 10.2).
 *
 * The claim only a browser can check: the signing secret is shown once and is
 * gone from the screen afterwards, and an endpoint's backlog is visible —
 * because the failure mode of ordered delivery is silence, not an error.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Koppelingen BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('a webhook is added, shows its secret once, and can be removed', async ({ page }) => {
  await anAdministration(page)

  await page.getByRole('link', { name: 'Webhooks', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible()
  await expect(page.getByText('Nog geen webhooks.')).toBeVisible()

  await page.getByRole('button', { name: 'Webhook toevoegen' }).click()
  await page.getByLabel('URL').fill('https://example.test/klopt/hook')
  await page.getByRole('button', { name: 'Aanmaken' }).click()

  // Once, and only once. There is no screen that could show it again, because
  // only the encrypted copy is kept.
  await expect(page.getByText('Dit is het ondertekeningsgeheim')).toBeVisible()
  const secret = await page.locator('code', { hasText: /^whsec_/ }).innerText()
  expect(secret).toMatch(/^whsec_/)

  await page.getByRole('button', { name: 'Ik heb het bewaard' }).click()
  await expect(page.getByText(secret)).toBeHidden()

  await page.reload()
  await expect(page.getByText('https://example.test/klopt/hook')).toBeVisible()
  await expect(page.getByText(secret)).toBeHidden()

  await page.getByRole('button', { name: 'Verwijderen' }).click()
  await expect(page.getByText('Nog geen webhooks.')).toBeVisible()
})

test('the catalogue is offered rather than asking for free text', async ({ page }) => {
  // An integrator who has to guess an event name guesses wrong, and a filter
  // that silently matches nothing is the worst possible answer.
  await anAdministration(page)

  await page.goto('/webhooks')
  await page.getByRole('button', { name: 'Webhook toevoegen' }).click()

  await expect(page.getByRole('checkbox', { name: /sales\.invoice\.issued/ })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /ledger\.entry\.posted/ })).toBeVisible()
})
