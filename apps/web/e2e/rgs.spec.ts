import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * RGS-koppelingen op het grootboek.
 *
 * The dashboard has reported coverage as a percentage since M0 and there was no
 * way to act on the number: you could see that you were at 93% and do nothing
 * about it. `rgs.setMappings` existed the whole time (#6).
 *
 * In a browser because both halves are screen behaviour. A refused code has to
 * arrive next to the field that is wrong rather than as a blank panel, and the
 * figure on a *different* screen has to move when this one saves — which is the
 * acceptance criterion, and is invisible to a handler test.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('a code is changed from the table, and the dashboard figure follows', async ({ page }) => {
  await anAdministration(page, 'Koppelende Boeken BV')

  await page.goto('/accounts')
  await hydrated(page)

  // Enter on the focused row opens the editor: the table's own key, and the
  // reason this is not an input inside a cell fighting the type-ahead.
  await page.getByRole('cell', { name: '1000' }).click()
  await expect(page.getByRole('heading', { name: /RGS-code voor 1000/ })).toBeVisible()

  const field = page.getByLabel('RGS-code')
  await expect(field).toHaveValue('BLimKasKas')

  // Emptying it is a real thing to want: a wrongly mapped account reports
  // wrongly, and unmapped is at least honestly unmapped.
  await field.fill('')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('1000 heeft geen RGS-code meer.')).toBeVisible()
  await expect(page.getByRole('row', { name: /^1000 / }).getByText('niet gekoppeld')).toBeVisible()

  // The figure on the dashboard is a different screen reading the same
  // coverage. It has to have moved.
  await page.goto('/')
  await expect(page.getByText('Niet-gekoppelde rekeningen')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Koppelingen bijwerken' })).toBeVisible()

  // And back, by typing the code in. Enter commits, because Enter commits the
  // thing you are in.
  await page.goto('/accounts')
  await hydrated(page)
  await page.getByRole('cell', { name: '1000' }).click()
  await page.getByLabel('RGS-code').fill('BLimKasKas')
  await page.getByLabel('RGS-code').press('Enter')
  await expect(page.getByText('1000 rapporteert nu onder BLimKasKas.')).toBeVisible()
})

test('a code that is not in the scheme is refused where it was typed', async ({ page }) => {
  await anAdministration(page, 'Verzonnen Codes BV')

  await page.goto('/accounts')
  await hydrated(page)

  await page.getByRole('cell', { name: '4400' }).click()
  await page.getByLabel('RGS-code').fill('NietEenCode')
  await page.getByRole('button', { name: 'Opslaan' }).click()

  // The mapper's own sentence, in the panel with the field in it — and the old
  // mapping is untouched, because nothing was applied.
  await expect(page.getByRole('alert')).toContainText('NietEenCode')
  await expect(page.getByLabel('RGS-code')).toHaveValue('NietEenCode')
  await expect(page.getByRole('row', { name: /^4400 / })).toContainText('WBedKanCea')

  // Escape abandons the edit, which is principle 2 and not a property of this
  // screen.
  await page.getByLabel('RGS-code').press('Escape')
  await expect(page.getByRole('heading', { name: /RGS-code voor 4400/ })).toHaveCount(0)
})
