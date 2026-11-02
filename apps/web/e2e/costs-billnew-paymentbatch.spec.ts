import { expect, test, type Page } from '@playwright/test'
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
 * Redesign Phase 4 — BillNew + PaymentBatch (#107 / #128).
 *
 * Covers route from sidebar and ⌘K, empty state, seeded state, keyboard use,
 * and no console errors. Fixtures: Eva/Ruben, example.nl, NL91ABNA0417164300.
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
  await enableAdvancedMode(page)
  await hydrated(page)
}

async function aSupplier(page: Page): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-9100')
  await page.getByLabel('Naam', { exact: true }).fill('Telecom Fictief')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL009988776B01')
  await page.getByLabel('E-mail').fill('facturen@example.nl')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Telecom Fictief' })).toBeVisible()
}

async function aBankAccount(page: Page): Promise<void> {
  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByLabel('Naam', { exact: true }).fill('Demo bankrekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL91ABNA0417164300')).toBeVisible()
}

test('BillNew from sidebar and command bar; empty and seeded; keyboard; no console errors', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await openAdmin(page, 'BillNew Demo BV')

  // Sidebar → Kosten → Factuur invoeren (list still pre-#159 on this branch)
  await page
    .getByRole('link', { name: /^Kosten/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/purchases/)
  await page.getByRole('link', { name: /Factuur invoeren|Factuur toevoegen/ }).click()
  await expect(page).toHaveURL(/\/purchases\/new/)
  await expect(page.getByRole('heading', { name: 'Nieuwe inkoopfactuur' })).toBeVisible()
  // Empty: no suppliers yet
  await expect(page.getByText(/nog geen leverancier/i)).toBeVisible()
  await expect(page.getByText(/OCR|automatisch gelezen|AI|PSD2|secure|GDPR/i)).toHaveCount(0)

  await aSupplier(page)

  // Command bar → new purchase
  await page.goto('/')
  await hydrated(page)
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  // `n i` (title) and `n r` ("… of bon") both open BillNew — pick the title.
  const newBill = palette.getByRole('option', { name: /Nieuwe inkoopfactuur(?! of)/ })
  await expect(newBill).toBeVisible()
  await newBill.click()
  await expect(page).toHaveURL(/\/purchases\/new/)
  await expect(page.getByRole('heading', { name: 'Nieuwe inkoopfactuur' })).toBeVisible()
  await expect(
    page.getByText(/controleert de totalen|never recalculates|herberekent nooit/i),
  ).toBeVisible()
  await expect(page.getByText(/Alleen UBL|Only UBL/i)).toBeVisible()

  await page.setViewportSize({ width: 1440, height: 1040 })
  await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toHaveCount(0)

  await page.getByLabel('Hun nummer').fill('INK-DEMO-2025-0039')
  await page.getByLabel('Factuurdatum').fill('2026-02-10')
  await page.getByLabel('Vervaldatum').fill('2026-03-12')
  await page.getByLabel('Exclusief btw', { exact: true }).fill('100,00')
  await page.getByLabel('Btw', { exact: true }).fill('21,00')
  await page.getByLabel('Totaal', { exact: true }).fill('121,00')
  await page.getByLabel('Omschrijving regel 1').fill('Demo verzekering Q1')
  await chooseOption(page, 'Grootboek regel 1', /^4400 /)
  await chooseOption(page, 'Btw-code regel 1', /^VH21/)
  await page.getByLabel('Excl. btw regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()

  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Boeken' })).toBeVisible()

  // Keyboard: Esc returns to Costs
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/purchases/)

  // Re-open and save draft with ⌘S
  await page.goto('/purchases/new')
  await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
  await page.getByLabel('Hun nummer').fill('INK-DEMO-2025-0040')
  await page.getByLabel('Factuurdatum').fill('2026-02-11')
  await page.getByLabel('Vervaldatum').fill('2026-03-13')
  await page.getByLabel('Exclusief btw', { exact: true }).fill('200,00')
  await page.getByLabel('Btw', { exact: true }).fill('42,00')
  await page.getByLabel('Totaal', { exact: true }).fill('242,00')
  await page.getByLabel('Omschrijving regel 1').fill('Demo internet')
  await chooseOption(page, 'Grootboek regel 1', /^4400 /)
  await chooseOption(page, 'Btw-code regel 1', /^VH21/)
  await page.getByLabel('Excl. btw regel 1').fill('200,00')
  await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByRole('heading', { name: /INK-DEMO-2025-0040/ })).toBeVisible()

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

test('PaymentBatch from sidebar and command bar; empty and seeded; keyboard; no console errors', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await openAdmin(page, 'PaymentBatch Demo BV')
  await aBankAccount(page)

  // Sidebar Kosten → Betaalbatches tab (alsoActiveFor /payments)
  await page
    .getByRole('link', { name: /^Kosten/ })
    .first()
    .click()
  await page
    .getByRole('navigation', { name: 'Kostensecties' })
    .getByRole('link', { name: 'Betaalbatches' })
    .click()
  await expect(page).toHaveURL(/\/payments/)
  await expect(page.getByRole('heading', { name: 'Kosten' })).toBeVisible()
  await expect(page.getByText('Nog geen betaalbatches.')).toBeVisible()
  await expect(
    page.getByText(/PSD2|betaalt Klopt|Klopt betaalt|live connection|gekoppeld/i),
  ).toHaveCount(0)

  // Command bar
  await page.goto('/')
  await hydrated(page)
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await expect(palette.getByRole('option', { name: /^Betalingen/ })).toBeVisible()
  await palette.getByRole('option', { name: /^Betalingen/ }).click()
  await expect(page).toHaveURL(/\/payments/)

  await page.setViewportSize({ width: 1440, height: 1040 })
  await page.getByRole('button', { name: 'Nieuwe batch' }).click()
  await page.getByLabel('Kenmerk').fill('BETAAL-EVA-1')
  await page.getByRole('button', { name: 'Aanmaken' }).click()
  await expect(page.getByRole('heading', { name: /Batch BETAAL-EVA-1|Batch van / })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Voortgang van de batch' })).toBeVisible()
  // Empty batch: submit hidden
  await expect(page.getByRole('button', { name: 'Ter fiattering aanbieden' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Betaling toevoegen' }).click()
  await page.getByLabel('Begunstigde').fill('Ruben Demo')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByLabel('Bedrag', { exact: true }).fill('42,00')
  await page.getByLabel('Eigen kenmerk').fill('INK-DEMO-2025-0039')
  await page.getByLabel('Omschrijving').fill('Demo post')
  await page.getByRole('button', { name: 'Toevoegen' }).click()
  await expect(page.getByText('Ruben Demo')).toBeVisible()
  await expect(page.getByText(/NL91 ABNA 0417 1643 00/)).toBeVisible()

  await expect(page.getByRole('button', { name: 'Ter fiattering aanbieden' })).toBeVisible()
  // Keyboard ⌘↵ submits for approval
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByText(/Status is nu: wacht op fiat|wacht op fiat/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /Batch fiatteren|Fiatteren/ })).toHaveCount(0)
  await expect(
    page.getByText(/Wie klaarzet, mag niet fiatteren|iemand anders moet/i).first(),
  ).toBeVisible()
  await expect(page.getByText(/Upload het in je bankieren-app|pain\.001/i)).toHaveCount(0)

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})
