import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import {
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  signIn,
  uniqueEmail,
} from './support'

/**
 * Redesign Phase 8 VAT + ICP (#132): sidebar + ⌘K, empty and seeded states,
 * keyboard, filing button absent without Digipoort/SBR, and no console errors.
 * Fixture names use example.nl.
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
  // Digipoort/SBR unavailable on a fresh install — no disabled filing CTA.
  await expect(page.getByRole('button', { name: /Indienen bij de Belastingdienst/ })).toHaveCount(0)

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

  // Keyboard: ] / [ move period; D downloads without throwing.
  await page.goto('/vat/2026-Q1')
  await hydrated(page)
  await expect(page.getByRole('heading', { name: /Aangifte 1e kwartaal 2026/ })).toBeVisible()
  await page.keyboard.press(']')
  await expect(page).toHaveURL(/\/vat\/2026-Q2/)
  await expect(page.getByRole('heading', { name: /Aangifte 2e kwartaal 2026/ })).toBeVisible()
  await page.keyboard.press('[')
  await expect(page).toHaveURL(/\/vat\/2026-Q1/)
  await expect(page.getByRole('heading', { name: /Aangifte 1e kwartaal 2026/ })).toBeVisible()
  await page.keyboard.press('d')

  // Seeded VAT: domestic invoice so a box has lines.
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
  await expect(page.getByText('Windvaan Workshops (demo)')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Indienen bij de Belastingdienst/ })).toHaveCount(0)

  const lineButton = boxes.getByRole('button', { name: /regel/ }).first()
  await expect(lineButton).toBeVisible()
  await lineButton.click()
  await expect(page.getByRole('table', { name: /Grootboekregels achter rubriek/ })).toBeVisible()

  // Seeded ICP: EU customer + ICP invoice → /vat/icp, V shortcut, no filing CTA.
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-EU-1')
  await page.getByLabel('Naam', { exact: true }).fill('Windvaan EU (demo)')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('DE123456789')
  await page.getByLabel('E-mail').fill('einkauf@example.nl')
  await page.getByLabel('Straat').fill('Beispielstrasse')
  await page.getByLabel('Huisnr.').fill('2')
  await page.getByLabel('Postcode').fill('10115')
  await page.getByLabel('Plaats').fill('Berlin')
  await page.getByLabel('Land').fill('DE')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Windvaan EU (demo)' })).toBeVisible()

  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await chooseOption(page, /^Klant$/, /^DEB-EU-1 /)
  await page.getByLabel('Factuurdatum').fill('2026-02-20')
  await page.getByLabel('Omschrijving regel 1').fill('Demo EU levering')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Prijs regel 1').fill('500,00')
  await chooseOption(page, 'Btw regel 1', /^ICP /)
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('link', { name: 'boeking', exact: true })).toBeVisible()

  await page.goto('/vat/icp/2026-Q1')
  await hydrated(page)
  await expect(page.getByRole('heading', { name: 'ICP-opgaaf' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'DE123456789' })).toContainText(
    'Windvaan EU (demo)',
  )
  await expect(page.getByRole('button', { name: /Indienen bij de Belastingdienst/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Download/i })).toHaveCount(0)

  await page.keyboard.press('v')
  await expect(
    page.getByText(/geen VIES-verbinding geconfigureerd|VIES|offline|consultatie/i).first(),
  ).toBeVisible()

  // Phone 390: header actions under title; zero claim unsigned; ICP stacked; manual-filing hint.
  // hydrated() waits on the desktop sidebar kbd — skip it below md.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/vat/2026-Q1')
  const title = page.getByRole('heading', { name: /Aangifte 1e kwartaal 2026/ })
  const download = page.getByRole('button', { name: /Downloaden om zelf in te dienen/ })
  await expect(title).toBeVisible()
  await expect(download).toBeVisible()
  const titleBox = await title.boundingBox()
  const downloadBox = await download.boundingBox()
  expect(titleBox).not.toBeNull()
  expect(downloadBox).not.toBeNull()
  expect(downloadBox!.y).toBeGreaterThan(titleBox!.y + titleBox!.height - 2)
  expect(downloadBox!.width).toBeGreaterThan(300)
  expect(titleBox!.height).toBeLessThanOrEqual(60)
  await expect(page.getByRole('button', { name: /Indienen bij de Belastingdienst/ })).toHaveCount(0)
  await expect(
    page.getByText(
      /Deze installatie kan niet elektronisch indienen\. Download de cijfers en dien zelf in via Mijn Belastingdienst Zakelijk/,
    ),
  ).toBeVisible()
  const claim = page.getByText('Btw die je kunt terugvragen').locator('..')
  await expect(claim).toContainText('0,00')
  await expect(claim).not.toContainText('−')
  await expect(claim).not.toContainText('-0')

  await page.goto('/vat/icp/2026-Q1')
  await expect(page.getByRole('heading', { name: 'ICP-opgaaf' })).toBeVisible()
  const stacked = page.locator('ul').filter({ hasText: 'Windvaan EU (demo)' })
  const vatNumber = stacked.getByText('DE123456789')
  await expect(vatNumber).toBeVisible()
  const vatBox = await vatNumber.boundingBox()
  expect(vatBox).not.toBeNull()
  expect(vatBox!.x + vatBox!.width).toBeLessThanOrEqual(390)

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([])
})
