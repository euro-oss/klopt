import { expect, test, type Locator, type Page } from '@playwright/test'
import { createDatabase, closeDatabase, runMigrations } from '@klopt/db'
import { findUserIdByEmail } from '@klopt/db/testing'
import {
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  signIn,
  uniqueEmail,
} from './support'

/**
 * Redesign Phase 4 — BillNew + PaymentBatch (#107 / #128 / #175).
 *
 * Covers route from sidebar and ⌘K, empty state, seeded state, keyboard use,
 * 390 light/dark overflow + tap targets, 1440 lines table fit, and no console
 * errors. Fixtures: Eva/Ruben, example.nl, NL91ABNA0417164300.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function openAdmin(page: Page, name: string): Promise<string> {
  const email = uniqueEmail()
  await page.goto('/sign-in')
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
  return email
}

async function aSupplier(page: Page, opts?: { iban?: string | null }): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-9100')
  await page.getByLabel('Naam', { exact: true }).fill('Telecom Fictief')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL009988776B01')
  await page.getByLabel('E-mail').fill('facturen@example.nl')
  if (opts?.iban !== null) {
    await page.getByLabel('IBAN').fill(opts?.iban ?? 'NL91ABNA0417164300')
  }
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Telecom Fictief/ })).toBeVisible()
}

async function aBankAccount(page: Page): Promise<void> {
  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByLabel('Naam', { exact: true }).fill('Demo bankrekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  // Bank redesign (#171 on main) groups the IBAN; CI merges main so accept both forms.
  await expect(page.getByText(/Demo bankrekening/)).toBeVisible()
  await expect(page.getByText(/NL91\s*ABNA\s*0417\s*1643\s*00/)).toBeVisible()
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForFunction(
    (wantDark) => document.documentElement.classList.contains('dark') === wantDark,
    theme === 'dark',
  )
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true)
}

async function assertCostsTabsOneRow(page: Page): Promise<void> {
  const tabs = page.locator('[data-costs-tabs] a')
  await expect(tabs).toHaveCount(4)
  const tops = await tabs.evaluateAll((els) => els.map((el) => (el as HTMLElement).offsetTop))
  expect(new Set(tops).size, `Costs tabs wrap: offsetTops=${tops.join('/')}`).toBe(1)
  const row = page.locator('[data-costs-tabs-row]')
  await expect(row).toBeVisible()
  await expect
    .poll(async () =>
      row.evaluate((el) => {
        const style = getComputedStyle(el)
        return style.flexWrap === 'nowrap' || style.flexWrap === ''
      }),
    )
    .toBe(true)
}

async function assertStickyFormActions(page: Page): Promise<void> {
  const bar = page.locator('[data-testid="billnew-form-actions"]')
  const tabBar = page.locator('[data-phone-tab-bar]')
  await expect(bar).toBeVisible()
  await expect(bar).toHaveCSS('position', 'sticky')
  await expect(tabBar).toBeVisible()
  // Phone sticky bar: no keyboard chips (#175 design).
  await expect(bar.locator('kbd')).toHaveCount(0)
  const save = bar.getByRole('button', { name: 'Concept opslaan' })
  const book = bar.getByRole('button', { name: 'Boeken' })
  await expect(save).toBeVisible()
  await expect(book).toBeVisible()

  const saveBox = await save.boundingBox()
  const bookBox = await book.boundingBox()
  const tabBox = await tabBar.boundingBox()
  expect(saveBox, 'save box').not.toBeNull()
  expect(bookBox, 'book box').not.toBeNull()
  expect(tabBox, 'tab bar box').not.toBeNull()
  expect(Math.abs(saveBox!.y - bookBox!.y), 'save/book must share one row').toBeLessThan(8)
  // Must not sit under / intersect the z-40 phone tab bar (QA #175).
  expect(boxesOverlap(saveBox!, tabBox!), 'save ∩ tab bar').toBe(false)
  expect(boxesOverlap(bookBox!, tabBox!), 'book ∩ tab bar').toBe(false)

  const bookCenter = {
    x: bookBox!.x + bookBox!.width / 2,
    y: bookBox!.y + bookBox!.height / 2,
  }
  const hitIsFormActions = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)
    return el !== null && el.closest('[data-testid="billnew-form-actions"]') !== null
  }, bookCenter)
  expect(
    hitIsFormActions,
    'elementFromPoint(Boeken) must hit the sticky bar, not the tab bar',
  ).toBe(true)

  // Scroll the long form; sticky bar must stay clear of the tab bar.
  await page.locator('[data-testid="billnew-lines"]').scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, 800))
  await expect
    .poll(async () => {
      const barBox = await bar.boundingBox()
      const tab = await tabBar.boundingBox()
      if (barBox === null || tab === null) return false
      return !boxesOverlap(barBox, tab)
    })
    .toBe(true)
}

async function assertMinTapTarget(
  locator: ReturnType<Page['getByRole']>,
  label: string,
  min = 44,
): Promise<void> {
  if (!(await locator.isVisible())) return
  const box = await locator.boundingBox()
  expect(box, `${label} missing box`).not.toBeNull()
  expect(box!.height, `${label} tap height`).toBeGreaterThanOrEqual(min)
  expect(box!.width, `${label} tap width`).toBeGreaterThanOrEqual(min)
}

type Box = { x: number; y: number; width: number; height: number }

function boxesOverlap(a: Box, b: Box): boolean {
  const ax2 = a.x + a.width
  const ay2 = a.y + a.height
  const bx2 = b.x + b.width
  const by2 = b.y + b.height
  return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y
}

async function assertKeyControlsDoNotOverlap(
  controls: {
    label: string
    locator: Locator
  }[],
): Promise<void> {
  const boxes: { label: string; box: Box }[] = []
  for (const control of controls) {
    const count = await control.locator.count()
    for (let i = 0; i < count; i += 1) {
      const item = control.locator.nth(i)
      if (!(await item.isVisible())) continue
      const box = await item.boundingBox()
      if (box === null || box.width < 1 || box.height < 1) continue
      boxes.push({ label: `${control.label}#${i}`, box })
    }
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!
      const b = boxes[j]!
      expect(boxesOverlap(a.box, b.box), `overlap: "${a.label}" × "${b.label}"`).toBe(false)
    }
  }
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

  await page
    .getByRole('link', { name: /^Kosten/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/purchases/)
  await page.getByRole('link', { name: /Factuur invoeren|Factuur toevoegen/ }).click()
  await expect(page).toHaveURL(/\/purchases\/new/)
  await expect(page.getByRole('heading', { name: 'Nieuwe inkoopfactuur' })).toBeVisible()
  await expect(page.getByText(/nog geen leverancier/i)).toBeVisible()
  await expect(page.getByText(/OCR|automatisch gelezen|AI|PSD2|secure|GDPR/i)).toHaveCount(0)

  await aSupplier(page)

  await page.goto('/')
  await hydrated(page)
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  const newBill = palette.getByRole('option', { name: /Nieuwe inkoopfactuur(?! of)/ })
  await expect(newBill).toBeVisible()
  await newBill.click()
  await expect(page).toHaveURL(/\/purchases\/new/)
  await expect(page.getByRole('heading', { name: 'Nieuwe inkoopfactuur' })).toBeVisible()
  await expect(
    page.getByText(/controleert de totalen|never recalculates|herberekent nooit/i),
  ).toBeVisible()
  await expect(
    page.getByText(/Het document blijft bij deze factuur|document stays with this bill/i),
  ).toBeVisible()
  await expect(page.getByText(/vult Klopt in wat het las|Bestand staat in Postvak/i)).toHaveCount(0)
  // Column headers (phone also has md:sr-only amount labels with the same words).
  const colHeaders = page.locator('[data-testid="billnew-lines-grid"] > .bg-surface-hover')
  await expect(colHeaders.getByText('Btw-code', { exact: true })).toBeVisible()
  await expect(colHeaders.getByText('Btw-bedrag', { exact: true })).toBeVisible()
  await expect(page.getByText(/Facturen in \d{4}/)).toHaveCount(0)
  await expect(page.getByText(/Meestal geboekt op/)).toHaveCount(0)

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

  await expect
    .poll(async () =>
      page
        .locator('[data-testid="billnew-lines"]')
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    )
    .toBe(true)

  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/purchases/)

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

test('BillNew ⌘S reads the latest field value through useEffectEvent', async ({ page }) => {
  test.setTimeout(90_000)
  await openAdmin(page, 'BillNew Stale Save BV')
  await aSupplier(page)

  await page.goto('/purchases/new')
  await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
  await page.getByLabel('Hun nummer').fill('INK-STALE-1')
  await page.getByLabel('Factuurdatum').fill('2026-02-10')
  await page.getByLabel('Vervaldatum').fill('2026-03-12')
  await page.getByLabel('Exclusief btw', { exact: true }).fill('100,00')
  await page.getByLabel('Btw', { exact: true }).fill('21,00')
  await page.getByLabel('Totaal', { exact: true }).fill('121,00')
  await page.getByLabel('Omschrijving regel 1').fill('Stale check')
  await chooseOption(page, 'Grootboek regel 1', /^4400 /)
  await chooseOption(page, 'Btw-code regel 1', /^VH21/)
  await page.getByLabel('Excl. btw regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeVisible()

  // QA reproduced STALE-123 being saved as STALE-1 — edit then ⌘S immediately.
  const numberField = page.getByLabel('Hun nummer')
  await numberField.click()
  await numberField.fill('INK-STALE-123')
  await expect(numberField).toHaveValue('INK-STALE-123')
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByRole('heading', { name: /INK-STALE-123/ })).toBeVisible()
  await expect(page).toHaveURL(/\/purchases\/[^/]+$/)

  const invoiceId = page.url().split('/').pop() ?? ''
  const api = await page.request.get(`/api/v1/purchase-invoices/${invoiceId}`)
  expect(api.status()).toBe(200)
  const body = (await api.json()) as { supplierInvoiceNumber?: string }
  expect(body.supplierInvoiceNumber).toBe('INK-STALE-123')
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
  const steps = page.getByRole('list', { name: 'Voortgang van de batch' })
  await expect(steps).toBeVisible()
  await expect(steps.getByText('Voorbereiden')).toBeVisible()
  await expect(steps.getByText('Fiatteren')).toBeVisible()
  await expect(steps.getByText('Downloaden')).toBeVisible()
  await expect(steps.getByText('Bestand gedownload')).toBeVisible()
  await expect(steps.getByText('Betaald')).toHaveCount(0)
  await expect(steps.getByText('Bij de bank')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Ter fiattering aanbieden' })).toHaveCount(0)
  await expect(page.getByText('Nog niet ingediend')).toBeVisible()
  await expect(page.getByText('Nog niet goedgekeurd')).toBeVisible()
  await expect(page.getByText('Iemand anders dan de indiener keurt goed')).toBeVisible()
  await expect(page.getByText(/Gefiatteerd door|Goedgekeurd door/)).toHaveCount(0)

  await page.getByRole('button', { name: 'Betaling toevoegen' }).click()
  await page.getByLabel('Begunstigde').fill('Ruben Demo')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByLabel('Bedrag', { exact: true }).fill('42,00')
  await page.getByLabel('Eigen kenmerk').fill('INK-DEMO-2025-0039')
  await page.getByLabel('Omschrijving').fill('Demo post')
  await page.getByRole('button', { name: 'Toevoegen' }).click()
  await expect(
    page.locator('[data-testid="batch-lines-desktop"]').getByRole('cell', { name: 'Ruben Demo' }),
  ).toBeVisible()
  await expect(
    page.locator('[data-testid="batch-lines-desktop"]').getByText(/NL91 ABNA 0417 1643 00/),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: /· 1 factuur\b/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /1 facturen/ })).toHaveCount(0)

  await expect(page.getByRole('button', { name: 'Ter fiattering aanbieden' })).toBeVisible()
  await expect(
    page.getByText(
      /Als de IBAN's erin staan, bied je de batch aan\. Iemand anders met fiatteerrecht fiatteert hier\./,
    ),
  ).toBeVisible()
  await expect(page.getByText(/tweede eigenaar|second owner|krijgt een bericht/i)).toHaveCount(0)

  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByText(/Status is nu:/)).toHaveCount(0)
  await expect(page.getByText(/iemand anders moet hem fiatteren/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /Batch fiatteren|Fiatteren/ })).toHaveCount(0)
  // Submitter sees own email; never a literal ellipsis.
  await expect(page.getByText(/Ingediend door/)).toBeVisible()
  await expect(page.getByText(/Ingediend door …|Ingediend door \.\.\./)).toHaveCount(0)
  await expect(page.getByText('Nog niet goedgekeurd')).toBeVisible()
  await expect(page.getByText(/iemand anders moet/i).first()).toBeVisible()
  await expect(page.getByText(/Upload het in je bankieren-app|pain\.001/i)).toHaveCount(0)
  await expect(
    page.getByText(/lettert Match ze zelf|sluit de batch|matches them to these bills by itself/i),
  ).toHaveCount(0)

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

test('PaymentBatch ⌘↵ downloads pain.001 when approved', async ({ browser }) => {
  test.setTimeout(120_000)
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const alice = await browser.newContext()
  const bob = await browser.newContext()

  try {
    const alicePage = await alice.newPage()
    await openAdmin(alicePage, 'Download Shortcut BV')
    await aBankAccount(alicePage)

    const bobPage = await bob.newPage()
    const bobEmail = uniqueEmail()
    await bobPage.goto('/sign-in')
    await signIn(bobPage, bobEmail)
    await expect(bobPage.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

    await alicePage.goto('/members')
    const invite = alicePage.locator('form', {
      has: alicePage.getByRole('button', { name: 'Uitnodigen' }),
    })
    await invite.getByLabel('E-mail').fill(bobEmail)
    await chooseOption(alicePage, 'Rol', 'Accountant', invite)
    await alicePage.getByRole('button', { name: 'Uitnodigen' }).click()
    await expect(alicePage.getByText(new RegExp(`${bobEmail} heeft nu toegang`))).toBeVisible()

    await alicePage.goto('/payments')
    await alicePage.getByRole('button', { name: 'Nieuwe batch' }).click()
    await alicePage.getByLabel('Kenmerk').fill('BETAAL-CMD-1')
    await alicePage.getByRole('button', { name: 'Aanmaken' }).click()
    await alicePage.getByRole('button', { name: 'Betaling toevoegen' }).click()
    await alicePage.getByLabel('Begunstigde').fill('Ruben Demo')
    await alicePage.getByLabel('IBAN').fill('NL91ABNA0417164300')
    await alicePage.getByLabel('Bedrag', { exact: true }).fill('42,00')
    await alicePage.getByLabel('Eigen kenmerk').fill('INK-CMD-1')
    await alicePage.getByLabel('Omschrijving').fill('Shortcut demo')
    await alicePage.getByRole('button', { name: 'Toevoegen' }).click()
    await alicePage.getByRole('button', { name: 'Ter fiattering aanbieden' }).click()
    await expect(alicePage.getByText(/Status is nu:/)).toHaveCount(0)
    await expect(alicePage.getByText(/iemand anders moet hem fiatteren/)).toBeVisible()

    expect(await findUserIdByEmail(database, bobEmail)).not.toBeNull()
    await bobPage.goto('/payments')
    await expect(bobPage.getByRole('cell', { name: 'BETAAL-CMD-1' })).toBeVisible()
    await hydrated(bobPage)
    await bobPage.getByRole('cell', { name: 'BETAAL-CMD-1' }).click()
    // Approver has no display name for the submitter — nameless "Ingediend".
    const fourEyes = bobPage.locator('section', {
      has: bobPage.getByRole('heading', { name: 'Vier ogen' }),
    })
    await expect(fourEyes.getByText('Ingediend', { exact: true })).toBeVisible()
    await expect(fourEyes.getByText(/Ingediend door|…|\.\.\./)).toHaveCount(0)
    await expect(bobPage.getByRole('heading', { name: /· 1 factuur\b/ })).toBeVisible()

    await bobPage.getByRole('button', { name: /Batch fiatteren|Fiatteren/ }).click()
    await expect(bobPage.getByText(/Status is nu:/)).toHaveCount(0)
    await expect(bobPage.getByRole('button', { name: 'Betaalbestand downloaden' })).toBeVisible()
    // Approved with no display name — "Goedgekeurd", never "door …".
    await expect(fourEyes.getByText('Goedgekeurd', { exact: true })).toBeVisible()
    await expect(fourEyes.getByText(/Goedgekeurd door|…|\.\.\./)).toHaveCount(0)

    // Download *is* the export (#175): sets gedownload; no markSent button.
    await expect(
      bobPage.getByRole('button', { name: 'Markeren als ingediend bij de bank' }),
    ).toHaveCount(0)
    const downloadPromise = bobPage.waitForEvent('download')
    await bobPage.keyboard.press('ControlOrMeta+Enter')
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.pain001\.xml$/i)

    await expect(bobPage.getByText('Bestand uploaden bij je bank')).toBeVisible()
    await expect(bobPage.getByText(/Upload het bestand in je bankomgeving/)).toHaveCount(0)
    await expect(bobPage.getByText(/Gedownload bestand:/)).toBeVisible()
    const steps = bobPage.getByRole('list', { name: 'Voortgang van de batch' })
    await expect(steps.getByText('Voorbereiden')).toBeVisible()
    await expect(steps.getByText('Fiatteren')).toBeVisible()
    await expect(steps.getByText('Downloaden')).toBeVisible()
    await expect(steps.getByText('Bestand gedownload')).toBeVisible()
    await expect(steps.locator('[aria-current="step"]')).toHaveCount(0)
    await expect(steps.getByText('Betaald')).toHaveCount(0)
    await expect(steps.getByText('Bij de bank')).toHaveCount(0)
  } finally {
    await alice.close()
    await bob.close()
    await closeDatabase(database)
  }
})

test('BillNew phone amount fields show Excl. btw / Btw-bedrag labels at 390', async ({ page }) => {
  test.setTimeout(90_000)
  await openAdmin(page, 'BillNew Phone Labels BV')
  await aSupplier(page)

  await page.goto('/purchases/new')
  await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
  await page.setViewportSize({ width: 390, height: 844 })

  const lineCard = page.locator('[data-testid="billnew-line-1"]')
  await expect(lineCard).toBeVisible()
  const netLabel = lineCard.locator('label[for="billnew-net-0"]')
  const vatLabel = lineCard.locator('label[for="billnew-tax-0"]')
  await expect(netLabel).toBeVisible()
  await expect(netLabel).toHaveText('Excl. btw')
  await expect(vatLabel).toBeVisible()
  await expect(vatLabel).toHaveText('Btw-bedrag')
  // htmlFor association — clicking the label focuses the matching input.
  await netLabel.click()
  await expect(lineCard.locator('#billnew-net-0')).toBeFocused()
  await vatLabel.click()
  await expect(lineCard.locator('#billnew-tax-0')).toBeFocused()
  // Accessible name stays the line-specific aria-label; phone shows short CTA text.
  await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toContainText(
    'Btw berekenen',
  )
})

test('BillNew drop attaches the document and never claims Postvak', async ({ page }) => {
  test.setTimeout(120_000)
  await openAdmin(page, 'BillNew Document Attach BV')
  await aSupplier(page)

  await page.goto('/purchases/new')
  await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
  // Empty form: Postvak copy is only the drop-zone description (no document yet).
  await expect(page.getByText(/Het document blijft bij deze factuur/)).toBeVisible()
  await expect(page.getByTestId('billnew-document-attached')).toHaveCount(0)
  await expect(page.getByText(/Bestand staat in Postvak/)).toHaveCount(0)

  const fileInput = page.locator('[data-testid="billnew-document"] input[type="file"]')
  await expect(fileInput).toBeEnabled()
  await fileInput.setInputFiles({
    name: 'leverancier-factuur.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 billnew attach fixture', 'utf8'),
  })

  await expect(page.getByTestId('billnew-document-attached')).toBeVisible()
  await expect(page.getByText('Document bij deze factuur: leverancier-factuur.pdf')).toBeVisible()
  await expect(page.getByText(/Geen tweede upload/)).toBeVisible()
  // Drop zone gone — no second upload that could double-book.
  await expect(page.locator('[data-testid="billnew-document"] input[type="file"]')).toHaveCount(0)
  await expect(page.getByText(/Bestand staat in Postvak/)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Naar Postvak' })).toHaveCount(0)

  // Preferred path (#175): save links documentId to the bill; Postvak has no row.
  await chooseOption(page, 'Leverancier', /Telecom Fictief/)
  await page.getByLabel('Hun nummer').fill('INK-ATTACH-2026-1')
  await page.getByLabel('Factuurdatum').fill('2026-02-10')
  await page.getByLabel('Vervaldatum').fill('2026-03-12')
  await page.getByLabel('Exclusief btw', { exact: true }).fill('100,00')
  await page.getByLabel('Btw', { exact: true }).fill('21,00')
  await page.getByLabel('Totaal', { exact: true }).fill('121,00')
  await page.getByLabel('Omschrijving regel 1').fill('Attached bill')
  await chooseOption(page, 'Grootboek regel 1', /^4400 /)
  await expect(page.getByLabel('Btw-code regel 1')).toHaveText(/^VH21/)
  await page.getByLabel('Excl. btw regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page).toHaveURL(/\/purchases\/[0-9a-f-]+/)
  const invoiceId = page.url().split('/').pop() ?? ''
  expect(invoiceId.length).toBeGreaterThan(8)

  const invoice = await page.request.get(`/api/v1/purchase-invoices/${invoiceId}`)
  expect(invoice.status()).toBe(200)
  const invoiceBody = (await invoice.json()) as { documentIds?: string[] }
  expect(invoiceBody.documentIds?.length).toBe(1)

  const inbox = await page.request.get('/api/v1/inbox?state=new')
  expect(inbox.status()).toBe(200)
  const inboxBody = (await inbox.json()) as {
    items?: { filename?: string | null }[]
  }
  const listed = (inboxBody.items ?? []).some((item) => item.filename === 'leverancier-factuur.pdf')
  expect(listed, 'linked document must not appear in Postvak').toBe(false)

  await page.goto('/inbox')
  await expect(page.getByRole('heading', { name: 'Postvak' })).toBeVisible()
  await expect(page.getByText('leverancier-factuur.pdf')).toHaveCount(0)
})

test('BillNew and PaymentBatch at 390 light and dark: no overflow, no control overlap, 44px taps', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await openAdmin(page, 'Phone Costs Demo BV')
  await aSupplier(page)
  await aBankAccount(page)

  await page.setViewportSize({ width: 1440, height: 1040 })
  await page.goto('/purchases/new')
  await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
  await page.getByLabel('Hun nummer').fill('INK-PHONE-2026-1')
  await page.getByLabel('Factuurdatum').fill('2026-02-10')
  await page.getByLabel('Vervaldatum').fill('2026-03-12')
  await page.getByLabel('Exclusief btw', { exact: true }).fill('100,00')
  await page.getByLabel('Btw', { exact: true }).fill('21,00')
  await page.getByLabel('Totaal', { exact: true }).fill('121,00')
  await page.getByLabel('Omschrijving regel 1').fill('Phone demo')
  await chooseOption(page, 'Grootboek regel 1', /^4400 /)
  await expect(page.getByLabel('Btw-code regel 1')).toHaveText(/^VH21/)
  await page.getByLabel('Excl. btw regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeVisible()

  await expect
    .poll(async () =>
      page
        .locator('[data-testid="billnew-lines"]')
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    )
    .toBe(true)

  await page.setViewportSize({ width: 390, height: 844 })
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    await expect(page.getByRole('heading', { name: 'Nieuwe inkoopfactuur' })).toBeVisible()
    // Header Esc chip is desktop-only (#175).
    await expect(page.getByRole('link', { name: /Sluiten/ }).locator('kbd')).toBeHidden()
    await assertStickyFormActions(page)
    // Phone line cards: amounts fully visible, no clipped "100,0" (#175 QA).
    const lineCard = page.locator('[data-testid="billnew-line-1"]')
    await expect(lineCard).toBeVisible()
    // Visible amount labels below md (#175 Design); associated via htmlFor.
    const netLabel = lineCard.locator('label[for="billnew-net-0"]')
    const vatLabel = lineCard.locator('label[for="billnew-tax-0"]')
    await expect(netLabel).toBeVisible()
    await expect(netLabel).toHaveText('Excl. btw')
    await expect(vatLabel).toBeVisible()
    await expect(vatLabel).toHaveText('Btw-bedrag')
    await expect(lineCard.locator('#billnew-net-0')).toBeVisible()
    await expect(lineCard.locator('#billnew-tax-0')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toContainText(
      'Btw berekenen',
    )
    const net = lineCard.getByLabel('Excl. btw regel 1')
    await expect(net).toHaveValue('100,00')
    const netBox = await net.boundingBox()
    expect(netBox, 'net amount box').not.toBeNull()
    expect(netBox!.width, 'net amount not clipped').toBeGreaterThan(40)
    await expect
      .poll(async () =>
        page
          .locator('[data-testid="billnew-lines"]')
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      )
      .toBe(true)
    await assertNoHorizontalOverflow(page)
    await assertMinTapTarget(
      page
        .locator('[data-testid="billnew-form-actions"]')
        .getByRole('button', { name: 'Concept opslaan' }),
      'save',
    )
    await assertMinTapTarget(
      page.locator('[data-testid="billnew-form-actions"]').getByRole('button', { name: 'Boeken' }),
      'book',
    )
    await assertMinTapTarget(
      page.getByRole('button', { name: 'Btw berekenen voor regel 1' }),
      'compute',
    )
    await assertKeyControlsDoNotOverlap([
      { label: 'close', locator: page.getByRole('link', { name: /Sluiten/ }) },
      {
        label: 'save',
        locator: page
          .locator('[data-testid="billnew-form-actions"]')
          .getByRole('button', { name: 'Concept opslaan' }),
      },
      {
        label: 'book',
        locator: page
          .locator('[data-testid="billnew-form-actions"]')
          .getByRole('button', { name: 'Boeken' }),
      },
      { label: 'status', locator: page.getByText('Concept', { exact: true }) },
      {
        label: 'compute',
        locator: page.getByRole('button', { name: 'Btw berekenen voor regel 1' }),
      },
    ])
  }

  // Costs list tabs at 390 — one row (scroll horizontally, never wrap).
  await page.goto('/purchases')
  await expect(page.getByRole('heading', { name: 'Kosten' })).toBeVisible()
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    await assertCostsTabsOneRow(page)
    await assertNoHorizontalOverflow(page)
  }

  await page.setViewportSize({ width: 1440, height: 1040 })
  await setTheme(page, 'light')
  await page.goto('/payments')
  await page.getByRole('button', { name: 'Nieuwe batch' }).click()
  await page.getByLabel('Kenmerk').fill('BETAAL-PHONE-1')
  await page.getByRole('button', { name: 'Aanmaken' }).click()
  await page.getByRole('button', { name: 'Betaling toevoegen' }).click()
  await page.getByLabel('Begunstigde').fill('Ruben Demo')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByLabel('Bedrag', { exact: true }).fill('121,00')
  await page.getByLabel('Eigen kenmerk').fill('INK-PHONE-2026-1')
  await page.getByLabel('Omschrijving').fill('Phone demo')
  await page.getByRole('button', { name: 'Toevoegen' }).click()
  await expect(
    page.locator('[data-testid="batch-lines-desktop"]').getByRole('cell', { name: 'Ruben Demo' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ter fiattering aanbieden' })).toBeVisible()
  await expect(
    page.locator('[data-testid="batch-lines-desktop"]').getByRole('button', { name: 'Weg' }),
  ).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    await assertCostsTabsOneRow(page)
    const steps = page.getByRole('list', { name: 'Voortgang van de batch' })
    await expect(steps).toBeVisible()
    await expect(steps.getByText('Bestand gedownload')).toBeVisible()
    await expect(steps.getByText('Betaald')).toHaveCount(0)
    await expect(steps.getByText('Bij de bank')).toHaveCount(0)
    // Next-step CTA chips are desktop-only (#175) — present in DOM, hidden below md.
    const submitKbd = page.getByRole('button', { name: 'Ter fiattering aanbieden' }).locator('kbd')
    const submitKbdCount = await submitKbd.count()
    expect(submitKbdCount).toBeGreaterThan(0)
    for (let i = 0; i < submitKbdCount; i += 1) {
      await expect(submitKbd.nth(i)).toBeHidden()
    }
    // Two-line phone rows: supplier + amount and Weg stay in the 390 viewport.
    const phoneLines = page.locator('[data-testid="batch-lines-phone"]')
    await expect(phoneLines.getByText('Ruben Demo')).toBeVisible()
    await expect(phoneLines.getByRole('button', { name: 'Weg' })).toBeVisible()
    await expect(page.getByText(/^instructions:/i)).toHaveCount(0)
    await assertNoHorizontalOverflow(page)
    await assertMinTapTarget(phoneLines.getByRole('button', { name: 'Weg' }), 'weg')
    await assertMinTapTarget(
      page.getByRole('button', { name: 'Ter fiattering aanbieden' }),
      'submit',
    )
    await assertKeyControlsDoNotOverlap([
      { label: 'step-prepare', locator: steps.getByText('Voorbereiden') },
      { label: 'step-approve', locator: steps.getByText('Fiatteren') },
      { label: 'step-download', locator: steps.getByText('Downloaden') },
      { label: 'step-downloaded', locator: steps.getByText('Bestand gedownload') },
      {
        label: 'submit',
        locator: page.getByRole('button', { name: 'Ter fiattering aanbieden' }),
      },
      { label: 'add', locator: page.getByRole('button', { name: 'Betaling toevoegen' }) },
      { label: 'weg', locator: phoneLines.getByRole('button', { name: 'Weg' }) },
      { label: 'wait-pill', locator: page.getByText('Wacht', { exact: true }) },
    ])
  }

  // Missing-IBAN callout: "Open leveranciers" must not overlap the title at 390.
  await page.setViewportSize({ width: 1440, height: 1040 })
  await setTheme(page, 'light')
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-NOIBAN-E2E')
  await page.getByLabel('Naam', { exact: true }).fill('Zonder Iban E2E')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL009988776B01')
  await page.getByLabel('E-mail').fill('geeniban-e2e@example.nl')
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Zonder Iban E2E/ })).toBeVisible()

  await page.goto('/purchases/new')
  await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
  await chooseOption(page, 'Leverancier', /Zonder Iban E2E/)
  await page.getByLabel('Hun nummer').fill('INK-NOIBAN-E2E')
  await page.getByLabel('Factuurdatum').fill('2026-02-10')
  await page.getByLabel('Vervaldatum').fill('2026-03-12')
  await page.getByLabel('Exclusief btw', { exact: true }).fill('100,00')
  await page.getByLabel('Btw', { exact: true }).fill('21,00')
  await page.getByLabel('Totaal', { exact: true }).fill('121,00')
  await page.getByLabel('Omschrijving regel 1').fill('No IBAN demo')
  await chooseOption(page, 'Grootboek regel 1', /^4400 /)
  await expect(page.getByLabel('Btw-code regel 1')).toHaveText(/^VH21/)
  await page.getByLabel('Excl. btw regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
  await page.getByRole('button', { name: 'Boeken' }).click()
  await expect(page.getByRole('heading', { name: /INK-NOIBAN-E2E/ })).toBeVisible()
  await page.getByRole('button', { name: 'Goedkeuren voor betaling' }).click()
  await expect(page.getByText(/goedgekeurd voor betaling/i)).toBeVisible()

  await page.goto('/payments')
  await page.getByRole('button', { name: 'Nieuwe batch' }).click()
  await page.getByLabel('Kenmerk').fill('BETAAL-NOIBAN-E2E')
  await page.getByRole('button', { name: 'Aanmaken' }).click()
  await expect(page.getByText(/Deze leveranciers hebben nog geen IBAN/i)).toBeVisible()
  // Missing ≠ invalid: no "IBAN klopt niet" callout for a truly empty IBAN.
  await expect(page.getByText('IBAN klopt niet', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/^instructions:/i)).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    const title = page.getByText(/Deze leveranciers hebben nog geen IBAN/i)
    const openLink = page.getByRole('link', { name: 'Open leveranciers' })
    await expect(title).toBeVisible()
    await expect(openLink).toBeVisible()
    await assertKeyControlsDoNotOverlap([
      { label: 'missing-iban-title', locator: title },
      { label: 'open-suppliers', locator: openLink },
    ])
    await expect(page.getByText(/^instructions:/i)).toHaveCount(0)
    await assertNoHorizontalOverflow(page)
  }
})
