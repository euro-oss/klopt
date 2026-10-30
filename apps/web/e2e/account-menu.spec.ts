import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, openAccountMenu, signIn, uniqueEmail } from './support'

/**
 * The bottom of the sidebar, in a browser.
 *
 * The rail carries twenty destinations and used to finish with five more
 * controls — avatar, name, role, language, appearance, sign out — every one of
 * them printed at all times and four of them settled once a year. What is left
 * is a single row, and the settings are behind it. Boekhouddetails lives on
 * Settings, not in this menu.
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
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
}

test('the bottom of the rail is one row, not a settings panel', async ({ page }) => {
  await anAdministration(page, 'Stille Chrome BV')

  const profile = page.getByRole('region', { name: 'Profiel' })
  await expect(profile.getByRole('button')).toHaveCount(1)

  // Closed row shows role only; language / theme / sign-out stay behind the row.
  await expect(profile).toContainText(/Eigenaar/)
  await expect(profile).not.toContainText(/Geavanceerd/)
  await expect(page.getByLabel('Taal')).toHaveCount(0)
  await expect(page.getByLabel('Weergave')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Uitloggen' })).toHaveCount(0)
  await expect(
    page.getByRole('switch', { name: /Geavanceerd|Boekhouddetails|Advanced/i }),
  ).toHaveCount(0)

  await openAccountMenu(page)

  const panel = page.getByRole('dialog', { name: 'Profiel' })
  await expect(panel).toBeVisible()
  await expect(panel).toContainText(/Eigenaar/)
  await expect(panel).not.toContainText(/Geavanceerd/)
  await expect(panel.getByLabel('Taal')).toBeVisible()
  await expect(
    panel.getByRole('group', { name: 'Taal' }).getByRole('button', { name: 'NL' }),
  ).toBeVisible()
  await expect(
    panel.getByRole('group', { name: 'Taal' }).getByRole('button', { name: 'EN' }),
  ).toBeVisible()
  await expect(panel.getByLabel('Weergave')).toBeVisible()
  await expect(
    panel.getByRole('group', { name: 'Weergave' }).getByRole('button', { name: 'Licht' }),
  ).toBeVisible()
  await expect(
    panel.getByRole('group', { name: 'Weergave' }).getByRole('button', { name: 'Donker' }),
  ).toBeVisible()
  await expect(
    panel.getByRole('group', { name: 'Weergave' }).getByRole('button', { name: 'Systeem' }),
  ).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Uitloggen' })).toBeVisible()
  await expect(panel.getByRole('switch')).toHaveCount(0)
})

test('the menu opens upward, because there is nothing below it', async ({ page }) => {
  await anAdministration(page, 'Omhoog BV')

  const trigger = page.getByRole('region', { name: 'Profiel' }).getByRole('button')
  await openAccountMenu(page)

  const row = await trigger.boundingBox()
  // Whole panel (aria-labelled Profiel).
  const panel = await page.getByRole('dialog', { name: 'Profiel' }).boundingBox()
  expect(row).not.toBeNull()
  expect(panel).not.toBeNull()
  if (row === null || panel === null) return

  // A panel hung below the last row of the viewport is a panel nobody can
  // read, so the whole menu sits above the trigger.
  expect(panel.y + panel.height).toBeLessThanOrEqual(row.y + 1)
})

test('Esc puts the menu away and gives the focus back', async ({ page }) => {
  await anAdministration(page, 'Escape BV')

  const trigger = page.getByRole('region', { name: 'Profiel' }).getByRole('button')
  await openAccountMenu(page)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /Uitloggen|Sign out/ })).toBeHidden()

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
  await expect(page.getByRole('button', { name: /Uitloggen|Sign out/ })).toBeVisible()
})

test('signing out from the menu still signs you out', async ({ page }) => {
  await anAdministration(page, 'Uitloggen BV')

  await openAccountMenu(page)
  await page.getByRole('button', { name: 'Uitloggen' }).click()

  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(page.getByRole('button', { name: 'Stuur me een code' })).toBeVisible()
})
