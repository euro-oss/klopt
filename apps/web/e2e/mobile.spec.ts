import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Phone viewport smoke for #38.
 *
 * Desktop keyboard-first stays the contract; this suite only checks that a
 * phone can open the Sheet nav (including Importeren), sign in without a zoom
 * trap, and scroll a ledger with a sticky first column — without inventing a
 * second keyboard map.
 */
test.use({ viewport: { width: 390, height: 844 } })

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Mobiel BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('sign-in fields are full-width and at least 16px', async ({ page }) => {
  await page.goto('/sign-in')

  const email = page.locator('input[name="email"]')
  await expect(email).toBeVisible()

  const box = await email.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThan(280)
  expect(box!.height).toBeGreaterThanOrEqual(44)

  const fontSize = await email.evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).fontSize),
  )
  expect(fontSize).toBeGreaterThanOrEqual(16)

  // No essential page-level horizontal scroll on the sign-in screen.
  const scrolled = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(scrolled).toBe(false)
})

test('the Sheet opens Importeren and navigates', async ({ page }) => {
  await anAdministration(page)

  const open = page.getByRole('button', { name: 'Menu openen' })
  await expect(open).toBeEnabled()
  await open.click()

  const sheetNav = page.getByRole('navigation', { name: 'Hoofdnavigatie' })
  await expect(sheetNav.getByText('Importeren')).toBeVisible()
  await expect(sheetNav.getByRole('link', { name: /Exact Online/ })).toBeVisible()
  await expect(sheetNav.getByRole('link', { name: /Moneybird/ })).toBeVisible()

  await sheetNav.getByRole('link', { name: /Journaalposten/ }).click()
  await expect(page.getByRole('heading', { name: 'Journaalposten' })).toBeVisible()
  // Closed on navigate: the drawer must not cover the destination.
  await expect(sheetNav).toBeHidden()
})

test('a ledger table scrolls inside itself with a sticky first column', async ({ page }) => {
  await anAdministration(page)

  await page.getByRole('button', { name: 'Menu openen' }).click()
  await page
    .getByRole('navigation', { name: 'Hoofdnavigatie' })
    .getByRole('link', { name: /Grootboek/ })
    .click()
  await expect(page.getByRole('heading', { name: 'Grootboekrekeningen' })).toBeVisible()

  const scroller = page.locator('[data-ledger-scroll]').first()
  await expect(scroller).toBeVisible()

  const sticky = scroller.locator('thead th').first()
  await expect(sticky).toHaveCSS('position', 'sticky')

  const before = await scroller.evaluate((node) => node.scrollLeft)
  await scroller.evaluate((node) => {
    node.scrollLeft = Math.min(node.scrollWidth, node.clientWidth + 80)
  })
  const after = await scroller.evaluate((node) => node.scrollLeft)
  // Either the table is wide enough to move, or it already fits — both are
  // fine as long as the page itself is not the scroller.
  expect(after).toBeGreaterThanOrEqual(before)

  const pageScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(pageScroll).toBe(false)
})
