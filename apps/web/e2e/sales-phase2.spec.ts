import { expect, test, type Page } from '@playwright/test'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>
}

/**
 * Redesign Phase 2 Sales (#107): tabs, /dunning as Reminders, segments +
 * preview, phone layouts. Seeded data uses made-up companies and example.nl.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function openSales(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Verkoop Demo BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
}

async function seedCustomerAndInvoices(page: Page): Promise<void> {
  await page.getByRole('link', { name: /Relaties/ }).click()
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

  await page.goto('/settings')
  await page.getByLabel('Straat').fill('Demoweg')
  await page.getByLabel('Huisnummer').fill('10')
  await page.getByLabel('Postcode').fill('1000 BB')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('12345678')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL123456789B01')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()

  // One draft
  await page.getByRole('link', { name: /^Verkoop/ }).click()
  await page.getByRole('link', { name: 'Nieuwe factuur' }).click()
  await page.getByLabel('Omschrijving regel 1').fill('Demo levering concept')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Eenheid regel 1').fill('EA')
  await page.getByLabel('Prijs regel 1').fill('50,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page.getByRole('heading', { name: /Factuur Concept/ })).toBeVisible()

  // Two issued (Gefactureerd) so ArrowDown can move between rows.
  for (const [description, price] of [
    ['Demo levering open', '100,00'],
    ['Demo levering tweede', '75,00'],
  ] as const) {
    await page.getByRole('link', { name: /^Verkoop/ }).click()
    await page.getByRole('link', { name: 'Nieuwe factuur' }).click()
    await page.getByLabel('Omschrijving regel 1').fill(description)
    await page.getByLabel('Aantal regel 1').fill('1')
    await page.getByLabel('Eenheid regel 1').fill('EA')
    await page.getByLabel('Prijs regel 1').fill(price)
    await page.getByRole('button', { name: 'Concept opslaan' }).click()
    await page.getByRole('button', { name: 'Versturen en boeken' }).click()
    await expect(page.getByRole('heading', { name: /Factuur \d{4}-/ })).toBeVisible()
  }
}

test('Sales tabs: Facturen / Herinneringen / Klanten; /dunning opens Reminders', async ({
  page,
}) => {
  await openSales(page)
  await page.getByRole('link', { name: /^Verkoop/ }).click()
  await expect(page.getByRole('heading', { name: 'Verkoop' })).toBeVisible()

  const tabs = page.getByRole('navigation', { name: 'Verkoopsecties' })
  await expect(tabs.getByRole('link', { name: 'Facturen' })).toHaveAttribute('aria-current', 'page')
  await expect(tabs.getByRole('link', { name: 'Herinneringen' })).toBeVisible()
  await expect(tabs.getByRole('link', { name: 'Klanten' })).toBeVisible()

  // New invoice is secondary (outline), not the only primary on the page.
  const newInvoice = page.getByRole('link', { name: /Nieuwe factuur/ })
  await expect(newInvoice).toBeVisible()
  await expect(newInvoice).toHaveAttribute('data-variant', 'outline')

  await tabs.getByRole('link', { name: 'Herinneringen' }).click()
  await expect(page).toHaveURL(/\/dunning/)
  await expect(tabs.getByRole('link', { name: 'Herinneringen' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  // Read-only: no Change / Edit text / language pill.
  await expect(page.getByRole('link', { name: 'Change' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Edit text|Tekst bewerken/i })).toHaveCount(0)
  await expect(page.getByText('Dutch', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Nederlands', { exact: true })).toHaveCount(0)

  await page.goto('/dunning')
  await hydrated(page)
  await expect(page.getByRole('navigation', { name: 'Verkoopsecties' })).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Verkoopsecties' }).getByRole('link', {
      name: 'Herinneringen',
    }),
  ).toHaveAttribute('aria-current', 'page')

  await tabs.getByRole('link', { name: 'Klanten' }).click()
  await expect(page).toHaveURL(/\/contacts/)
})

test('segment counts and preview pane', async ({ page }) => {
  await openSales(page)
  await seedCustomerAndInvoices(page)
  await page.getByRole('link', { name: /^Verkoop/ }).click()
  await hydrated(page)

  const segments = page.getByRole('tablist', { name: 'Status' })
  await expect(segments.getByRole('tab', { name: /Concepten/ })).toContainText('1')
  await expect(segments.getByRole('tab', { name: /Gefactureerd/ })).toContainText(/[1-9]/)

  await segments.getByRole('tab', { name: /Concepten/ }).click()
  await expect(page).toHaveURL(/segment=draft/)
  await expect(page.getByText('Windvaan Workshops (demo)').first()).toBeVisible()

  await segments.getByRole('tab', { name: /Gefactureerd/ }).click()
  // Select a row so the preview opens (Escape clears it; no implicit first-row pane).
  await page
    .getByRole('button', { name: /Windvaan Workshops \(demo\)/ })
    .first()
    .click()
  await expect(page.getByRole('complementary', { name: 'Factuurvoorbeeld' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Factuurvoorbeeld' })).toContainText(
    'Windvaan Workshops (demo)',
  )
  // No Peppol claim.
  await expect(page.getByText(/Peppol/i)).toHaveCount(0)
})

test('phone Sales list at 390', async ({ page }) => {
  // Set up on desktop so hydration / Geavanceerd use the sidebar kbd signal,
  // then shrink to PhoneSales width.
  await openSales(page)
  await seedCustomerAndInvoices(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('link', { name: /^Verkoop/ }).click()
  await expect(page.getByRole('heading', { name: 'Verkoop' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Status' })).toBeVisible()
  // Preview is desktop-only; list rows are links on phone (desktop table is CSS-hidden).
  await expect(page.getByRole('complementary', { name: 'Factuurvoorbeeld' })).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: /Windvaan Workshops \(demo\)/ }).first(),
  ).toBeVisible()
})

test('Escape closes preview; ArrowDown/ArrowUp move like j/k; no console errors', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await openSales(page)
  await seedCustomerAndInvoices(page)
  await page.setViewportSize({ width: 1440, height: 1040 })
  await page.getByRole('link', { name: /^Verkoop/ }).click()
  await hydrated(page)

  const segments = page.getByRole('tablist', { name: 'Status' })
  await segments.getByRole('tab', { name: /Gefactureerd/ }).click()
  // Leave the tablist so ArrowDown is not stolen by the segmented control.
  await page.getByRole('heading', { name: 'Verkoop' }).click()
  // ArrowDown selects the first row and opens the preview (same as j).
  await page.keyboard.press('ArrowDown')
  await expect(page).toHaveURL(/[?&]id=/)
  await expect(page.getByRole('complementary', { name: 'Factuurvoorbeeld' })).toBeVisible()

  const firstId = new URL(page.url()).searchParams.get('id')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => new URL(page.url()).searchParams.get('id')).not.toBe(firstId)
  await page.keyboard.press('ArrowUp')
  await expect.poll(() => new URL(page.url()).searchParams.get('id')).toBe(firstId)

  // Escape closes the preview (drops id).
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/[?&]id=/)
  await expect(page.getByRole('complementary', { name: 'Factuurvoorbeeld' })).toHaveCount(0)

  // Filter focus: Escape blurs and still closes any re-opened preview.
  await page.getByRole('heading', { name: 'Verkoop' }).click()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('complementary', { name: 'Factuurvoorbeeld' })).toBeVisible()
  await page.getByLabel('Facturen filteren').focus()
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/[?&]id=/)
  await expect(page.getByRole('complementary', { name: 'Factuurvoorbeeld' })).toHaveCount(0)

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

test('phone detail back link returns to the segment the user came from', async ({ page }) => {
  await openSales(page)
  await seedCustomerAndInvoices(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/invoices?segment=draft')
  await expect(page.getByRole('tab', { name: /Concepten/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByRole('link', { name: /Windvaan Workshops \(demo\)/ }).click()
  await expect(page.getByRole('heading', { name: /.+/ }).first()).toBeVisible()
  await expect(page).toHaveURL(/segment=draft/)
  await page
    .getByRole('link', { name: /Verkoop/ })
    .first()
    .click()
  await expect(page).toHaveURL(/segment=draft/)
  await expect(page.getByRole('tab', { name: /Concepten/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

test('issued credit note CN2025-0041 shows Creditnota versturen on preview and detail', async ({
  page,
}) => {
  await openSales(page)
  await seedCustomerAndInvoices(page)

  // Credit an issued invoice, then rename to the QA case number.
  await page.setViewportSize({ width: 1440, height: 1040 })
  await page.goto('/invoices?segment=open')
  await hydrated(page)
  await page.getByRole('heading', { name: 'Verkoop' }).click()
  await page.keyboard.press('ArrowDown')
  const preview = page.getByRole('complementary', { name: 'Factuurvoorbeeld' })
  await expect(preview).toBeVisible()
  await preview.getByRole('button', { name: 'Creditnota' }).click()
  await expect(page.getByRole('heading', { name: /Creditnota Concept/ })).toBeVisible()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('heading', { name: /Creditnota CN\d{4}-/ })).toBeVisible()
  const creditId = new URL(page.url()).pathname.split('/').pop() ?? ''
  expect(creditId.length).toBeGreaterThan(10)

  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const sql = (database as unknown as { $client: SqlTag }).$client
  try {
    await sql`
      update klopt.sales_invoices
      set number = 'CN2025-0041'
      where id = ${creditId}::uuid
    `
  } finally {
    await closeDatabase(database)
  }

  // Full invoice page (desktop + phone share sendLabel).
  await page.goto(`/invoices/${creditId}`)
  await expect(page.getByRole('heading', { name: /CN2025-0041/ })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Creditnota versturen', exact: true }).first(),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Factuur versturen', exact: true })).toHaveCount(0)

  // Sales list preview pane.
  await page.goto('/invoices?segment=open')
  await hydrated(page)
  await page.getByRole('button', { name: /CN2025-0041/ }).click()
  const listPreview = page.getByRole('complementary', { name: 'Factuurvoorbeeld' })
  await expect(listPreview).toBeVisible()
  await expect(listPreview.getByText('CN2025-0041')).toBeVisible()
  await expect(
    listPreview.getByRole('button', { name: 'Creditnota versturen', exact: true }),
  ).toBeVisible()
  await expect(
    listPreview.getByRole('button', { name: 'Factuur versturen', exact: true }),
  ).toHaveCount(0)
})
