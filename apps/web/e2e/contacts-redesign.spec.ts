import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

/**
 * Redesign Phase 6 Contacts (#130): sidebar + ⌘K route, empty + seeded,
 * keyboard, no console errors. Fixture data uses example.nl and fake names.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function openContacts(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Relaties Demo BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
}

function attachConsoleGuard(page: Page): { errors: string[] } {
  const errors: string[] = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // Vite / React dev noise that is not a product failure.
    if (text.includes('Download the React DevTools')) return
    if (text.includes('third-party cookie')) return
    errors.push(text)
  })
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  return { errors }
}

async function seedContact(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-1301')
  await page.getByLabel('Naam', { exact: true }).fill('Windvaan Workshops (demo)')
  await page.getByLabel('E-mail').fill('facturen@example.nl')
  await page.getByLabel('Straat').fill('Voorbeeldstraat')
  await page.getByLabel('Huisnr.').fill('1')
  await page.getByLabel('Postcode').fill('1000 AA')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Windvaan Workshops \(demo\)/ })).toBeVisible()
}

test('Contacts opens from the sidebar and from the command bar', async ({ page }) => {
  const { errors } = attachConsoleGuard(page)
  await openContacts(page)

  await page
    .getByRole('navigation', { name: 'Hoofdnavigatie' })
    .getByRole('link', { name: /Relaties/ })
    .click()
  await expect(page).toHaveURL(/\/contacts/)
  await expect(page.getByRole('heading', { name: 'Relaties' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Rol' })).toBeVisible()

  await page.goto('/')
  await hydrated(page)
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await page.getByLabel('Zoek een scherm of een boeking').fill('Relaties')
  await expect(palette.getByRole('option', { name: /Relaties/ }).first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/contacts/)
  await expect(page.getByRole('heading', { name: 'Relaties' })).toBeVisible()

  expect(errors, errors.join('\n')).toEqual([])
})

test('empty state, seeded list + card, and keyboard navigation', async ({ page }) => {
  const { errors } = attachConsoleGuard(page)
  await openContacts(page)

  await page.getByRole('link', { name: /Relaties/ }).click()
  await hydrated(page)
  await expect(page.getByText('Nog geen relaties')).toBeVisible()

  await seedContact(page)
  await expect(page.getByRole('tab', { name: /Alles/ })).toContainText('1')
  await expect(page.getByRole('tab', { name: /Klanten/ })).toContainText('1')

  // Card opens after create (selected id in the URL).
  const card = page.getByRole('complementary', { name: 'Relatiekaart' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Windvaan Workshops (demo)')
  await expect(card).toContainText('DEB-1301')
  // Honest copy: no live-connection / gekoppeld claims.
  await expect(card).not.toContainText(/gekoppeld|live connection/i)

  // Segments 1–3 and j/k.
  await page.keyboard.press('2')
  await expect(page).toHaveURL(/role=customers/)
  await page.keyboard.press('1')
  await expect(page.getByRole('button', { name: /Windvaan Workshops \(demo\)/ })).toBeVisible()

  await page.keyboard.press('j')
  await expect(page).toHaveURL(/id=/)
  await page.keyboard.press('e')
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]+/)
  await expect(page.getByRole('heading', { name: /DEB-1301/ })).toBeVisible()

  expect(errors, errors.join('\n')).toEqual([])
})
