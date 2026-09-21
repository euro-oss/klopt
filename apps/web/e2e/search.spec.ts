import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * Zoeken vanuit het palet (#6, and #7's standard for how).
 *
 * `GET /search` has existed since M6 and the MCP `search` tool has been reading
 * it, so an agent could find a relatie by name and the bookkeeper could not.
 * This is the whole flow with the hands on the keys and no `click()` in it: open
 * the palette, type, arrow to the hit, Enter, and land on the record.
 *
 * It belongs here rather than in a handler test — `test/search.test.ts` already
 * holds the operation to its contract — because every failure this catches is
 * "the screen did not change": a debounce that never fires, a cursor that walks
 * one half of the list, an Enter that opens the palette's idea of the record
 * rather than the screen that shows it.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Zoekende Boeken BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

async function aContact(page: Page, number: string, name: string): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill(number)
  await page.getByLabel('Naam', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name })).toBeVisible()
}

test('the palette finds a relatie and opens it, with no pointer anywhere in the flow', async ({
  page,
}) => {
  await anAdministration(page)
  await aContact(page, 'REL-0001', 'Zeewaardig Tuigwerk B.V.')

  await page.goto('/')
  await hydrated(page)

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await expect(page.getByLabel('Zoek een scherm of een boeking')).toBeFocused()

  // One character searches the navigation only: `searchQuery` wants two, and a
  // validation failure is not what somebody who has not finished typing means.
  await page.keyboard.type('z')
  await expect(palette.getByText('Navigatie')).toBeVisible()
  await expect(palette.getByText('Inhoud')).toHaveCount(0)

  await page.keyboard.type('eewaardig')

  // Two halves, and the hits under the heading for their kind.
  await expect(palette.getByText('Inhoud')).toBeVisible()
  await expect(palette.getByText('Relaties')).toBeVisible()
  await expect(palette.getByText('Zeewaardig Tuigwerk B.V.')).toBeVisible()

  // The arrows walk both halves as one list. Nothing in the navigation matches
  // "zeewaardig", so the first row down is the hit.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')

  await expect(palette).toBeHidden()
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name: /Zeewaardig Tuigwerk/ })).toBeVisible()
})

test('a journaalpost is found by its description and opens the entry', async ({ page }) => {
  await anAdministration(page)

  await page.goto('/entries/new')
  await expect(page.getByRole('button', { name: 'Boeken', exact: true })).toBeEnabled()
  await page.getByLabel('Omschrijving', { exact: true }).fill('Ankerlier vervangen')
  await page.getByRole('combobox', { name: 'Rekening regel 1' }).pressSequentially('4400')
  await page.keyboard.press('Enter')
  await page.getByLabel('Debet regel 1').fill('99,00')
  await page.getByRole('combobox', { name: 'Rekening regel 2' }).pressSequentially('1100')
  await page.keyboard.press('Enter')
  await page.getByLabel('Credit regel 2').fill('99,00')
  await page.getByRole('button', { name: 'Boeken', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Boeken', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Dit wordt geboekt' })).toBeHidden()

  await page.goto('/')
  await hydrated(page)

  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('ankerlier')

  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette.getByText('Journaalposten').last()).toBeVisible()
  await expect(palette.getByText('Ankerlier vervangen')).toBeVisible()

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]+$/)
})

test('Escape closes the palette and the slash key is still nobody’s', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/')
  await hydrated(page)

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('zee')
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()

  // `/` stays unbound, per docs/keyboard-map.md. Now that there *is* a search
  // to focus, this is the assertion that says the palette is the only way in
  // rather than the first of two.
  await page.keyboard.press('/')
  await expect(palette).toHaveCount(0)
})

test('the palette says nothing was found rather than showing an empty Inhoud', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/')
  await hydrated(page)

  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('zzzzqqq')

  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette.getByText('Niets gevonden.')).toBeVisible()
  await expect(palette.getByText('Inhoud')).toHaveCount(0)
})
