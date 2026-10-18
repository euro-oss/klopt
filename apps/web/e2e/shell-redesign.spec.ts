import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import {
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  openAccountMenu,
  signIn,
  uniqueEmail,
} from './support'

/**
 * Redesign shell slice 2 (#61): nav IA, Geavanceerd, ⌘K.
 *
 * Screen content is out of scope; these specs only pin the chrome contracts
 * that Product signed off against the #57 prototype.
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
  await hydrated(page)
}

test('daily-work groups come first in the rail', async ({ page }) => {
  await anAdministration(page, 'IA BV')

  const nav = page.getByRole('navigation', { name: 'Hoofdnavigatie' })
  const text = await nav.innerText()
  const sales = text.indexOf('Verkoop')
  const purchasing = text.indexOf('Inkoop')
  const money = text.indexOf('Geld')
  const books = text.indexOf('Boekhouden')
  const reports = text.indexOf('Rapporten')
  const imports = text.indexOf('Importeren')
  const admin = text.indexOf('Beheer')

  expect(sales).toBeGreaterThan(-1)
  expect(purchasing).toBeGreaterThan(sales)
  expect(money).toBeGreaterThan(purchasing)
  expect(books).toBeGreaterThan(money)
  expect(reports).toBeGreaterThan(books)
  expect(imports).toBeGreaterThan(reports)
  expect(admin).toBeGreaterThan(imports)

  await expect(nav.getByRole('link', { name: /Koppelen/ })).toBeVisible()
})

test('Geavanceerd hides Journaalposten and Proefbalans from the nav', async ({ page }) => {
  await anAdministration(page, 'Eenvoud BV')

  const nav = page.getByRole('navigation', { name: 'Hoofdnavigatie' })
  await expect(nav.getByRole('link', { name: /Journaalposten/ })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: /Proefbalans/ })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: /Categorieën/ })).toBeVisible()

  await enableAdvancedMode(page)

  await expect(nav.getByRole('link', { name: /Journaalposten/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /Proefbalans/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /Grootboek/ })).toBeVisible()
})

test('⌘K still reaches Journaalposten when Geavanceerd is off', async ({ page }) => {
  await anAdministration(page, 'Palette BV')

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await expect(palette.getByRole('option', { name: /Geavanceerd aanzetten/ })).toBeVisible()

  await page.keyboard.type('journaal')
  await expect(palette.getByRole('option', { name: /Journaalposten/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Journaalposten' })).toBeVisible()
})

test('? opens keyboard help and mentions Geavanceerd is unbound', async ({ page }) => {
  await anAdministration(page, 'Help BV')

  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Sneltoetsen' })
  await expect(help).toBeVisible()
  await expect(help.getByText(/Geavanceerd heeft bewust geen sneltoets/)).toBeVisible()
})

test('turning Geavanceerd off from the menu hides the advanced nav again', async ({ page }) => {
  await anAdministration(page, 'Toggle BV')
  await enableAdvancedMode(page)

  const nav = page.getByRole('navigation', { name: 'Hoofdnavigatie' })
  await expect(nav.getByRole('link', { name: /Journaalposten/ })).toBeVisible()

  await openAccountMenu(page)
  await page.getByRole('switch', { name: /Geavanceerd/ }).click()
  await expect(page.getByRole('switch', { name: /Geavanceerd/ })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await page.keyboard.press('Escape')

  await expect(nav.getByRole('link', { name: /Journaalposten/ })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: /Proefbalans/ })).toHaveCount(0)
})
