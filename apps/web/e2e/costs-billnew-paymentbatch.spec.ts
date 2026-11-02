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
  await page.getByLabel('Naam van de administratie').fill(name)
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
  await expect(page.getByText('NL91ABNA0417164300')).toBeVisible()
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
  await expect(bar).toBeVisible()
  await expect(bar).toHaveCSS('position', 'sticky')
  await expect(bar.getByRole('button', { name: 'Concept opslaan' })).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Boeken' })).toBeVisible()

  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  const height = viewport!.height

  // Scroll the long form; sticky bar must stay in the visual viewport.
  await page.locator('[data-testid="billnew-lines"]').scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, 800))
  await expect
    .poll(async () => {
      const box = await bar.boundingBox()
      if (box === null) return false
      return box.y >= 0 && box.y + box.height <= height + 1
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
  await expect(page.getByText(/Postvak|Inbox/i).first()).toBeVisible()
  await expect(page.getByText(/vult Klopt in wat het las/i)).toHaveCount(0)
  await expect(page.getByText('Btw-code', { exact: true })).toBeVisible()
  await expect(page.getByText('Btw-bedrag', { exact: true })).toBeVisible()
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
  await expect(page.getByText('Ruben Demo')).toBeVisible()
  await expect(page.getByText(/NL91 ABNA 0417 1643 00/)).toBeVisible()
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
  await expect(page.getByText(/Status is nu: wacht op fiat|wacht op fiat/i)).toBeVisible()
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
    await expect(alicePage.getByText(/Status is nu: wacht op fiat/)).toBeVisible()

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
    await expect(bobPage.getByText(/Status is nu: gefiatteerd/)).toBeVisible()
    await expect(bobPage.getByRole('button', { name: 'Download pain.001' })).toBeVisible()
    // Approved with no display name — "Goedgekeurd", never "door …".
    await expect(fourEyes.getByText('Goedgekeurd', { exact: true })).toBeVisible()
    await expect(fourEyes.getByText(/Goedgekeurd door|…|\.\.\./)).toHaveCount(0)

    const downloadPromise = bobPage.waitForEvent('download')
    await bobPage.keyboard.press('ControlOrMeta+Enter')
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.pain001\.xml$/i)
  } finally {
    await alice.close()
    await bob.close()
    await closeDatabase(database)
  }
})

test('BillNew and PaymentBatch at 390 light and dark: no overflow, no control overlap, 44px taps', async ({
  page,
}) => {
  test.setTimeout(180_000)
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
    await assertStickyFormActions(page)
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
  await expect(page.getByText('Ruben Demo')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ter fiattering aanbieden' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Weg' })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    await assertCostsTabsOneRow(page)
    const steps = page.getByRole('list', { name: 'Voortgang van de batch' })
    await expect(steps).toBeVisible()
    await expect(steps.getByText('Bestand gedownload')).toBeVisible()
    await expect(steps.getByText('Betaald')).toHaveCount(0)
    await expect(steps.getByText('Bij de bank')).toHaveCount(0)
    await assertNoHorizontalOverflow(page)
    await assertMinTapTarget(page.getByRole('button', { name: 'Weg' }), 'weg')
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
      { label: 'weg', locator: page.getByRole('button', { name: 'Weg' }) },
      { label: 'wait-pill', locator: page.getByText('Wacht', { exact: true }) },
    ])
  }
})
