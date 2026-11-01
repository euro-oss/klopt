import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

/**
 * Redesign Phase 8 VAT (#132): one spec for sidebar + ⌘K, empty and seeded
 * states, keyboard, and no console errors. Fixture names use example.nl.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function openAdmin(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
}

function attachConsoleGuard(page: Page): { readonly errors: string[] } {
  const errors: string[] = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => {
    errors.push(String(error))
  })
  return { errors }
}

test('VAT redesign: sidebar, command bar, empty + seeded, keyboard, no console errors', async ({
  page,
}) => {
  const { errors } = attachConsoleGuard(page)
  await openAdmin(page, 'Voorbeeld BTW BV')

  // Sidebar → /vat (redirects into a period).
  await page
    .getByRole('navigation', { name: 'Hoofdnavigatie' })
    .getByRole('link', { name: /^BTW/ })
    .click()
  await hydrated(page)
  await expect(page).toHaveURL(/\/vat\//)
  await expect(page.getByRole('heading', { name: 'BTW' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'BTW-periodes' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Downloaden om zelf in te dienen/ })).toBeVisible()

  // Empty-ish state: zeros, ICP empty card, no fake EU customers.
  await expect(page.getByText(/Geen verkopen aan EU-bedrijven/)).toBeVisible()
  await expect(page.getByText(/Rheinblick|Atelier Escaut|DE000000000/)).toHaveCount(0)

  // Command bar → BTW.
  await page.goto('/')
  await hydrated(page)
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('btw')
  await expect(palette.getByRole('option', { name: /^BTW/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await hydrated(page)
  await expect(page).toHaveURL(/\/vat/)
  await expect(page.getByRole('heading', { name: 'BTW' })).toBeVisible()

  // Keyboard: go to a concrete period, press ] / [ and D without throwing.
  await page.goto('/vat/2026-Q1')
  await hydrated(page)
  await page.keyboard.press(']')
  await page.keyboard.press('[')
  await page.keyboard.press('d')

  // Seeded state: one fake customer + invoice so a box has lines.
  await enableAdvancedMode(page)
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-9001')
  await page.getByLabel('Naam', { exact: true }).fill('Windvaan Workshops (demo)')
  await page.getByLabel('E-mail').fill('facturen@example.nl')
  await page.getByLabel('Straat').fill('Voorbeeldstraat')
  await page.getByLabel('Huisnr.').fill('1')
  await page.getByLabel('Postcode').fill('1000 AA')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Windvaan Workshops (demo)' })).toBeVisible()

  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Factuurdatum').fill('2026-02-10')
  await page.getByLabel('Omschrijving regel 1').fill('Demo levering Q1')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Prijs regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('link', { name: 'boeking', exact: true })).toBeVisible()

  await page.goto('/vat/2026-Q1')
  await hydrated(page)
  const boxes = page.getByRole('table', { name: 'Rubrieken van de BTW-aangifte' })
  await expect(boxes.getByRole('row').filter({ hasText: 'hoog tarief' })).toContainText('100,00')
  await expect(page.getByText('Windvaan Workshops (demo)')).toHaveCount(0) // names stay on sales, not VAT boxes

  // Expand a box with Enter-friendly control.
  const lineButton = boxes.getByRole('button', { name: /regel/ }).first()
  await expect(lineButton).toBeVisible()
  await lineButton.click()
  await expect(page.getByRole('table', { name: /Grootboekregels achter rubriek/ })).toBeVisible()

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([])
})
