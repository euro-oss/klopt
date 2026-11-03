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
 * Redesign Phase 4 Costs (#107 / #128): Kosten route from sidebar and ⌘K,
 * empty state, seeded bills list + preview, keyboard navigation, no console
 * errors. Fixture names only (example.nl / fake suppliers).
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function openCostsEmpty(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Kosten Demo BV')
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
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-9001')
  await page.getByLabel('Naam', { exact: true }).fill('Telecom Fictief')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL009988776B01')
  await page.getByLabel('E-mail').fill('facturen@example.nl')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  // Contacts #163: list rows are buttons, not table cells.
  await expect(page.getByRole('button', { name: /Telecom Fictief/ })).toBeVisible()
}

async function enterBill(
  page: Page,
  number: string,
  opts: { book?: boolean; approve?: boolean } = {},
): Promise<void> {
  await page.goto('/purchases/new')
  // Wait for hydration (ƒ), not merely an enabled textbox — fills before React
  // owns the controls are discarded and Concept opslaan stays disabled.
  await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
  // BillNew #175 labels (was Factuurnummer leverancier / Bedrag excl. btw on #159).
  await page.getByLabel('Hun nummer').fill(number)
  await page.getByLabel('Factuurdatum').fill('2026-02-10')
  await page.getByLabel('Vervaldatum').fill('2026-03-12')
  await page.getByLabel('Exclusief btw', { exact: true }).fill('100,00')
  await page.getByLabel('Btw', { exact: true }).fill('21,00')
  await page.getByLabel('Totaal', { exact: true }).fill('121,00')
  await page.getByLabel('Omschrijving regel 1').fill('Demo levering')
  await chooseOption(page, 'Grootboek regel 1', /^4400 /)
  await chooseOption(page, 'Btw-code regel 1', /^VH21/)
  await page.getByLabel('Excl. btw regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeVisible()
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page.getByRole('heading', { name: `Inkoopfactuur ${number}` })).toBeVisible()

  if (opts.book === true || opts.approve === true) {
    await page.getByRole('button', { name: 'Boeken', exact: true }).click()
    await expect(page.getByRole('link', { name: /^boeking \d/ })).toBeVisible()
  }
  if (opts.approve === true) {
    await page.getByRole('button', { name: 'Goedkeuren voor betaling' }).click()
    await expect(page.getByText('goedgekeurd voor betaling')).toBeVisible()
  }
}

test('Costs from sidebar and from command bar; empty state', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await openCostsEmpty(page)

  // Sidebar
  await page
    .getByRole('link', { name: /^Kosten/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/purchases/)
  await expect(page.getByRole('heading', { name: 'Kosten' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Kostensecties' })).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Kostensecties' }).getByRole('link', { name: 'Facturen' }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Nog geen inkoopfacturen.')).toBeVisible()
  // No OCR / AI claim on empty or add CTA.
  await expect(page.getByText(/OCR|automatisch gelezen|AI/i)).toHaveCount(0)

  // Command bar
  await page.goto('/')
  await hydrated(page)
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await palette.getByRole('option', { name: /^Kosten/ }).click()
  await expect(page).toHaveURL(/\/purchases/)
  await expect(page.getByRole('heading', { name: 'Kosten' })).toBeVisible()

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

test('seeded bills: segments, preview, keyboard; no console errors', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await openCostsEmpty(page)
  await aSupplier(page)
  await enterBill(page, 'INK-DEMO-2025-0002', { book: true, approve: true })
  await enterBill(page, 'INK-DEMO-2025-0005', { book: true })

  await page.setViewportSize({ width: 1440, height: 1040 })
  await page
    .getByRole('link', { name: /^Kosten/ })
    .first()
    .click()
  await hydrated(page)
  await expect(page.getByRole('heading', { name: 'Kosten' })).toBeVisible()

  const segments = page.getByRole('tablist', { name: 'Status' })
  await expect(segments.getByRole('tab', { name: /Alles/ })).toContainText(/[1-9]/)
  await expect(segments.getByRole('tab', { name: /Te betalen/ })).toContainText(/[1-9]/)

  // Tabs: To approve badge
  const tabs = page.getByRole('navigation', { name: 'Kostensecties' })
  await expect(tabs.getByRole('link', { name: /Te fiatteren/ })).toContainText('1')

  await segments.getByRole('tab', { name: /Te betalen/ }).click()
  await expect(page).toHaveURL(/segment=open/)
  await expect(page.getByText('Telecom Fictief').first()).toBeVisible()

  // Leave tablist so ArrowDown is not stolen by the segmented control.
  await page.getByRole('heading', { name: 'Kosten' }).click()
  await page.keyboard.press('ArrowDown')
  await expect(page).toHaveURL(/[?&]id=/)
  const preview = page.getByRole('complementary', { name: 'Factuurvoorbeeld' })
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('Telecom Fictief')
  // Honest approval copy — not four-eyes on the bill itself.
  await expect(preview.getByText('Waiting for a second person')).toHaveCount(0)
  await expect(preview.getByText('Wachten op een tweede persoon')).toHaveCount(0)
  await expect(preview.getByText('Geen voorbeeld van het document')).toBeVisible()
  await expect(preview.getByText('vergroot')).toHaveCount(0)
  await expect(page.getByText('naar betaalbatches', { exact: true })).toBeVisible()

  const firstId = new URL(page.url()).searchParams.get('id')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => new URL(page.url()).searchParams.get('id')).not.toBe(firstId)
  await page.keyboard.press('ArrowUp')
  await expect.poll(() => new URL(page.url()).searchParams.get('id')).toBe(firstId)

  // Approved payable bill shows the honest /payments shortcut label.
  await page
    .getByRole('region', { name: 'Facturenlijst' })
    .getByRole('button', { name: /INK-DEMO-2025-0002/ })
    .click()
  await expect(preview.getByRole('button', { name: 'Naar betaalbatches' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/[?&]id=/)
  await expect(page.getByRole('complementary', { name: 'Factuurvoorbeeld' })).toHaveCount(0)

  // Payment batches / Suppliers tabs route out.
  await tabs.getByRole('link', { name: 'Betaalbatches' }).click()
  await expect(page).toHaveURL(/\/payments/)
  await page
    .getByRole('link', { name: /^Kosten/ })
    .first()
    .click()
  await tabs.getByRole('link', { name: 'Leveranciers' }).click()
  await expect(page).toHaveURL(/\/contacts/)

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(
    overflow.scrollWidth,
    `${label}: scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`,
  ).toBeLessThanOrEqual(overflow.clientWidth)
}

test('phone 390 light and dark: overdue button clear of title; tabs one line; no horizontal overflow', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openCostsEmpty(page)
  await aSupplier(page)
  // Due in the past so the overdue banner shows at 390.
  await enterBill(page, 'INK-PHONE-0001', { book: true, approve: true })

  await page.goto('/purchases?segment=open')
  await hydrated(page)

  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    await page.evaluate((t) => {
      document.documentElement.classList.toggle('dark', t === 'dark')
    }, theme)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('heading', { name: 'Kosten' })).toBeVisible()

    const banner = page.getByRole('alert', { name: /te laat|overdue/i }).first()
    await expect(banner).toBeVisible()
    await expect(banner.getByText(/Iemand anders dan de indiener/)).toBeVisible()
    const title = banner.locator('[data-costs-overdue-title]')
    const prepare = banner.locator('[data-costs-overdue-prepare]')
    await expect(title).toBeVisible()
    await expect(prepare).toBeVisible()
    const titleBox = await title.boundingBox()
    const prepareBox = await prepare.boundingBox()
    expect(titleBox, 'overdue title box').not.toBeNull()
    expect(prepareBox, 'prepare button box').not.toBeNull()
    if (titleBox !== null && prepareBox !== null) {
      const intersects =
        titleBox.x < prepareBox.x + prepareBox.width &&
        titleBox.x + titleBox.width > prepareBox.x &&
        titleBox.y < prepareBox.y + prepareBox.height &&
        titleBox.y + titleBox.height > prepareBox.y
      expect(intersects, `${theme} list: prepare overlaps overdue title`).toBe(false)
    }

    const tabs = page.locator('[data-costs-tabs] a')
    await expect(tabs).toHaveCount(4)
    const tops = await tabs.evaluateAll((els) => els.map((el) => (el as HTMLElement).offsetTop))
    expect(new Set(tops).size, `${theme} list: tabs share one offsetTop`).toBe(1)

    await assertNoHorizontalOverflow(page, `${theme} costs list`)

    // Bill detail at 390 — phone list links to /purchases/$id (desktop table is hidden).
    await page.locator('.md\\:hidden a[href*="/purchases/"]', { hasText: 'INK-PHONE-0001' }).click()
    await expect(page).toHaveURL(/\/purchases\/[0-9a-f-]+/)
    await expect(page.getByRole('heading', { name: /Inkoopfactuur INK-PHONE-0001/ })).toBeVisible()
    await assertNoHorizontalOverflow(page, `${theme} bill detail`)

    await page.goto('/purchases?segment=open')
    await expect(page.getByRole('heading', { name: 'Kosten' })).toBeVisible()
  }
})
