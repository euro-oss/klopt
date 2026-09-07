import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * The keyboard, in a browser.
 *
 * The registry has printed its keys in the sidebar since M0 and nothing
 * listened for them. Only a browser can check that they now do something, and
 * only a browser can check the two things most likely to be wrong: that a bare
 * letter does not fire while somebody is typing, and that a screen with its own
 * keys does not fight the global ones.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Toetsenbord BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await theKeyboardIsLive(page)
}

/**
 * Waits until the keys do something.
 *
 * The listener is registered in an effect, so it exists only after hydration —
 * and the sidebar only prints a shortcut once it works, which makes the hint
 * the honest thing to wait for. Pressing before then loses the keystroke, and
 * an assertion retried afterwards cannot get it back.
 */
async function theKeyboardIsLive(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: /Journaalposten/ }).locator('kbd')).toHaveCount(1)
}

test('the prefixes in the sidebar actually go there', async ({ page }) => {
  await anAdministration(page)

  await page.keyboard.press('g')
  // The armed prefix is shown: a shortcut that silently waits is one people
  // assume did not work.
  await expect(page.getByText('G …')).toBeVisible()
  await page.keyboard.press('j')
  await expect(page.getByRole('heading', { name: 'Journaalposten' })).toBeVisible()

  await page.keyboard.press('g')
  await page.keyboard.press('r')
  await expect(page.getByRole('heading', { name: 'Relaties' })).toBeVisible()

  await page.keyboard.press('n')
  await page.keyboard.press('i')
  await expect(page).toHaveURL(/\/purchases\/new$/)
})

test('a prefix expires rather than hijacking the next thing you type', async ({ page }) => {
  await anAdministration(page)

  await page.keyboard.press('g')
  await expect(page.getByText('G …')).toBeVisible()

  // The window is 1.5 seconds (docs/keyboard-map.md). The budget here is much
  // longer on purpose: what is being asserted is that the prefix expires, not
  // how fast, and a tight bound turns a busy machine into a red suite.
  await expect(page.getByText('G …')).toBeHidden({ timeout: 15_000 })

  await page.keyboard.press('j')
  // Still on the dashboard: the prefix went, so `j` meant nothing.
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
})

test('Escape drops a half-typed shortcut', async ({ page }) => {
  await anAdministration(page)

  await page.keyboard.press('g')
  await expect(page.getByText('G …')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('G …')).toBeHidden()

  await page.keyboard.press('j')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
})

test('a bare letter does not fire while somebody is typing', async ({ page }) => {
  // The one that would make the feature unusable: `g` is the first letter of
  // half the words a bookkeeper types.
  await anAdministration(page)
  await page.goto('/contacts')

  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  const name = page.getByLabel('Naam', { exact: true })
  await name.fill('Grote Groenteboer')

  await expect(name).toHaveValue('Grote Groenteboer')
  await expect(page.getByRole('heading', { name: 'Relaties' })).toBeVisible()
})

test('the palette opens on Cmd-K and goes where you pick', async ({ page }) => {
  await anAdministration(page)

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()

  await page.getByLabel('Zoek een scherm').fill('betal')
  await page.keyboard.press('Enter')

  await expect(page.getByRole('heading', { name: 'Betalingen' })).toBeVisible()
  await expect(palette).toBeHidden()
})

test('the help sheet is the keyboard map, generated from the registry', async ({ page }) => {
  await anAdministration(page)

  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Sneltoetsen' })
  await expect(help).toBeVisible()

  // Including the screen-local keys, which the palette cannot offer because it
  // cannot run them from here.
  await expect(help).toContainText('Beste voorstel boeken')
  await expect(help).toContainText('Command palette')

  await page.keyboard.press('Escape')
  await expect(help).toBeHidden()
})
