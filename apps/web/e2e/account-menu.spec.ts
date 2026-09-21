import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, openAccountMenu, signIn, uniqueEmail } from './support'

/**
 * The bottom of the sidebar, in a browser.
 *
 * The rail carries twenty destinations and used to finish with five more
 * controls — avatar, name, role, language, appearance, sign out — every one of
 * them printed at all times and four of them settled once a year. What is left
 * is a single row, and the four settings are behind it.
 *
 * These specs are about the chrome rather than about what the settings do:
 * that the row is one row, that the panel comes up rather than down, that Esc
 * puts it away and gives the focus back, and that signing out still signs you
 * out. The language and theme specs prove the settings themselves still work
 * from in there.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('the bottom of the rail is one row, not a settings panel', async ({ page }) => {
  await anAdministration(page, 'Stille Chrome BV')

  const profile = page.getByRole('region', { name: 'Profiel' })
  await expect(profile.getByRole('button')).toHaveCount(1)

  // The four that moved. None of them is on the screen until somebody asks.
  await expect(page.getByLabel('Taal / Language')).toHaveCount(0)
  await expect(page.getByLabel('Weergave')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Afmelden' })).toHaveCount(0)
  await expect(page.getByText(/^rol: /)).toHaveCount(0)

  await openAccountMenu(page)

  await expect(page.getByLabel('Taal / Language')).toBeVisible()
  await expect(page.getByLabel('Weergave')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Afmelden' })).toBeVisible()
  await expect(page.getByText(/^rol: /)).toBeVisible()
})

test('the menu opens upward, because there is nothing below it', async ({ page }) => {
  await anAdministration(page, 'Omhoog BV')

  const trigger = page.getByRole('region', { name: 'Profiel' }).getByRole('button')
  await openAccountMenu(page)

  const row = await trigger.boundingBox()
  const panel = await page.getByRole('dialog').boundingBox()
  expect(row).not.toBeNull()
  expect(panel).not.toBeNull()
  if (row === null || panel === null) return

  // A panel hung below the last row of the viewport is a panel nobody can
  // read, so the whole of it sits above the row it belongs to.
  expect(panel.y + panel.height).toBeLessThanOrEqual(row.y + 1)
})

test('Esc puts the menu away and gives the focus back', async ({ page }) => {
  await anAdministration(page, 'Escape BV')

  const trigger = page.getByRole('region', { name: 'Profiel' }).getByRole('button')
  await openAccountMenu(page)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()

  // Back on the row that opened it, rather than on `<body>` with Tab starting
  // over from the top of the navigation.
  await expect(trigger).toBeFocused()
})

test('the row is reachable by keyboard, and opens on Enter', async ({ page }) => {
  await anAdministration(page, 'Toetsenbord BV')

  const trigger = page.getByRole('region', { name: 'Profiel' }).getByRole('button')
  await expect(trigger).toBeEnabled()

  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('signing out from the menu still signs you out', async ({ page }) => {
  await anAdministration(page, 'Afmelden BV')

  await openAccountMenu(page)
  await page.getByRole('button', { name: 'Afmelden' }).click()

  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.getByRole('button', { name: 'Stuur me een code' })).toBeVisible()
})
