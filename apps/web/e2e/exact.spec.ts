import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Overzetten uit Exact Online, in een browser (spec 13).
 *
 * Nothing here reaches Exact — the token exchange and every read happen on the
 * server, so there is no request a browser test could intercept. What a browser
 * *can* check is the part that goes wrong for a human rather than for a client:
 *
 * - The three steps appear in order, and the later ones stay out of the way
 *   until the earlier one is done. A division chooser visible before there is a
 *   connection is a chooser somebody clicks and gets an error from.
 * - The redirect URI is filled in with this instance's own origin, because
 *   Exact compares it literally and a human retyping it gets it wrong.
 * - The sign-in button refuses to be pressed without a client id and secret,
 *   rather than starting a handshake that Exact will reject.
 * - The callback screen with no code says so instead of spinning forever.
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

test('the Exact screen offers only the step that can be done', async ({ page }) => {
  await anAdministration(page)

  await page.getByRole('link', { name: 'Exact Online' }).click()
  await expect(page.getByRole('heading', { name: 'Exact Online' })).toBeVisible()

  await expect(page.getByRole('heading', { name: '1. Verbinden' })).toBeVisible()
  // Choosing an administration and previewing are meaningless before there is a
  // connection, so they are not on the screen at all.
  await expect(page.getByRole('heading', { name: '2. Welke administratie' })).toBeHidden()
  await expect(page.getByRole('heading', { name: '3. Proefimport' })).toBeHidden()
})

test('the redirect URI is filled in with this instance’s own origin', async ({ page }) => {
  // Exact compares it literally. A human retyping the port gets it wrong, and
  // the failure is at Exact's end with an error that does not say why.
  await anAdministration(page)
  await page.goto('/exact')

  const redirect = page.getByLabel('Redirect-URI')
  await expect(redirect).toHaveValue(`${new URL(page.url()).origin}/exact/callback`)
})

test('signing in at Exact is refused until there is an app to sign in with', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/exact')

  const button = page.getByRole('button', { name: 'Aanmelden bij Exact' })
  await expect(button).toBeDisabled()

  await page.getByLabel('Client ID').fill('some-client-id')
  // Still disabled: half an app is not an app.
  await expect(button).toBeDisabled()

  await page.getByLabel('Client secret').fill('some-client-secret')
  await expect(button).toBeEnabled()
})

test('the callback screen says when Exact sent it nothing', async ({ page }) => {
  // Somebody lands here by opening a bookmark, or because Exact refused. A
  // spinner would be a lie.
  await anAdministration(page)
  await page.goto('/exact/callback')

  await expect(page.getByText('Geen autorisatiecode ontvangen van Exact.')).toBeVisible()
})

test('the callback screen shows Exact’s own refusal', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/exact/callback?error=access_denied')

  await expect(page.getByRole('alert')).toContainText('access_denied')
})

test('g x reaches the Exact screen', async ({ page }) => {
  await anAdministration(page)

  // The listener lives in an effect, so it exists only after hydration — and
  // the sidebar prints a key only once it works, which makes the hint the
  // honest thing to wait for. Pressing before then loses the keystroke.
  await expect(page.getByRole('link', { name: /Journaalposten/ }).locator('kbd')).toHaveCount(1)

  await page.keyboard.press('g')
  // The armed prefix is shown: a shortcut that silently waits is one people
  // assume did not work.
  await expect(page.getByText('G …')).toBeVisible()
  await page.keyboard.press('x')

  await expect(page.getByRole('heading', { name: 'Exact Online' })).toBeVisible()
})
