import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import { chooseOption, DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'
import { installFiscalYearBookingFakeClock } from './support/fiscal-year-booking-fake-clock'
import { withPngSourceChunk } from './support/png-source-chunk.js'

const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', '200')
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'
const SCREENSHOT_SOURCE = 'apps/web/e2e/pr-screenshots-200.spec.ts'

type SqlTag = {
  (strings: TemplateStringsArray, ...values: readonly unknown[]): Promise<unknown>
}

async function entityId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/entity')
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { id: string }
  return body.id
}

async function setTaxCodeValidTo(id: string, code: string, validTo: string): Promise<void> {
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const sql = (database as unknown as { $client: SqlTag }).$client
  try {
    await sql`
      update klopt.tax_codes
      set valid_to = ${validTo}::date
      where entity_id = ${id}::uuid
        and code = ${code}
    `
  } finally {
    await closeDatabase(database)
  }
}

async function setTaxCodeValidFrom(id: string, code: string, validFrom: string): Promise<void> {
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const sql = (database as unknown as { $client: SqlTag }).$client
  try {
    await sql`
      update klopt.tax_codes
      set valid_from = ${validFrom}::date
      where entity_id = ${id}::uuid
        and code = ${code}
    `
  } finally {
    await closeDatabase(database)
  }
}

const SIZES = [
  { label: 'desktop-1440', width: 1440, height: 900 },
  { label: 'mobile-390', width: 390, height: 844 },
] as const

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/200')

async function aSupplier(page: Page): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Leverancier B.V.')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL987654321B01')
  await page.getByLabel('E-mail').fill('leverancier@example.nl')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Leverancier B\.V\./ })).toBeVisible()
}

async function aCustomer(page: Page): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Klant B.V.')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL123456789B01')
  await page.getByLabel('E-mail').fill('klant@example.nl')
  await page.getByRole('checkbox', { name: /Klant/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Klant B\.V\./ })).toBeVisible()
}

async function setBillDate(page: Page, isoDate: string): Promise<void> {
  const field = page.getByLabel('Factuurdatum', { exact: true })
  await field.click()
  await field.fill(isoDate)
  await expect(field).toHaveValue(isoDate)
}

test.use({ timezoneId: 'Europe/Amsterdam' })

async function ready(page: Page): Promise<void> {
  await installFiscalYearBookingFakeClock(page)
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.goto('/setup')
  await page.getByLabel('Naam', { exact: true }).fill('Boekjaar Poort BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
  await aSupplier(page)
  await aCustomer(page)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme })
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
  }, theme)
  if (theme === 'dark') {
    await expect(page.locator('html')).toHaveClass(/dark/)
  } else {
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  }
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

async function mobileTabBarInset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-phone-tab-bar]')
    if (!(bar instanceof HTMLElement)) return 80
    return Math.ceil(bar.getBoundingClientRect().height) + 8
  })
}

async function scrollClipTargetIntoView(
  page: Page,
  scrollTarget: Locator,
  mobile: boolean,
): Promise<void> {
  await scrollTarget.scrollIntoViewIfNeeded()
  if (!mobile) return
  const inset = await mobileTabBarInset(page)
  await scrollTarget.evaluate((el, bottomInset) => {
    const rect = el.getBoundingClientRect()
    const limit = window.innerHeight - bottomInset
    if (rect.bottom > limit) {
      window.scrollBy(0, rect.bottom - limit)
    }
    if (rect.top < 8) {
      window.scrollBy(0, rect.top - 8)
    }
  }, inset)
}

async function shoot(page: Page, name: string, scrollTarget?: Locator): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height })
      await expect(page.locator('body')).toBeVisible()
      const mobile = size.width === 390
      if (scrollTarget !== undefined) {
        await scrollClipTargetIntoView(page, scrollTarget, mobile)
        await expect(scrollTarget).toBeVisible()
        const box = await scrollTarget.boundingBox()
        if (box !== null) {
          const inset = mobile ? await mobileTabBarInset(page) : 0
          const viewportHeight = size.height
          const clipY = Math.max(0, box.y - 12)
          const maxHeight = viewportHeight - inset - clipY
          const clipHeight = Math.min(box.height + 24, maxHeight)
          const png = await page.screenshot({
            animations: 'disabled',
            clip: {
              x: Math.max(0, box.x - 12),
              y: clipY,
              width: Math.min(box.width + 24, size.width - Math.max(0, box.x - 12)),
              height: Math.max(1, clipHeight),
            },
          })
          writeFileSync(
            join(OUT, `${name}-${theme}-${size.label}.png`),
            withPngSourceChunk(png, SCREENSHOT_SOURCE),
          )
          continue
        }
      } else {
        await page.evaluate(() => window.scrollTo(0, 0))
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
      }
      await expect(page.locator('body')).toBeVisible()
      const png = await page.screenshot({ fullPage: false, animations: 'disabled' })
      writeFileSync(
        join(OUT, `${name}-${theme}-${size.label}.png`),
        withPngSourceChunk(png, SCREENSHOT_SOURCE),
      )
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => window.scrollTo(0, 0))
}

async function shootPurchaseVatHidden(page: Page): Promise<void> {
  const hint = page.locator('#purchase-invoice-date-hint')
  const line = page.getByTestId('billnew-line-1')
  await expect(hint).toContainText('Boekjaar 2025 is nog niet geopend.')
  await expect(page.getByText('Kies een andere')).toHaveCount(0)
  await expect(page.getByLabel('Btw-code regel 1')).toContainText('VH21')

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height })
      await expect(page.locator('body')).toBeVisible()
      const inset = size.width === 390 ? await mobileTabBarInset(page) : 0
      await line.scrollIntoViewIfNeeded()
      const clip = await page.evaluate(
        ({ inset, pad }) => {
          const hintEl = document.querySelector('#purchase-invoice-date-hint')
          const lineEl = document.querySelector('[data-testid="billnew-line-1"]')
          if (!(hintEl instanceof HTMLElement) || !(lineEl instanceof HTMLElement)) {
            throw new Error('purchase-vat-hidden clip targets missing')
          }
          const docTop = (element: HTMLElement): number =>
            element.getBoundingClientRect().top + window.scrollY
          const docBottom = (element: HTMLElement): number => docTop(element) + element.offsetHeight
          const hintTop = docTop(hintEl) - pad
          const lineBottom = docBottom(lineEl) + pad
          const view = window.innerHeight - inset
          const limit = view
          const fitBottom = Math.max(0, lineBottom - view)
          let scrollY = hintTop >= fitBottom ? fitBottom : hintTop
          window.scrollTo(0, scrollY)
          if (hintEl.getBoundingClientRect().top < pad) {
            scrollY = hintTop
            window.scrollTo(0, scrollY)
          }
          if (window.innerWidth <= 390) {
            const hintBox = hintEl.getBoundingClientRect()
            const clipY = Math.max(0, hintBox.top - pad)
            return {
              x: 0,
              y: clipY,
              width: window.innerWidth,
              height: Math.max(1, limit - clipY),
            }
          }
          const merge = (): DOMRect => {
            const a = hintEl.getBoundingClientRect()
            const b = lineEl.getBoundingClientRect()
            const mergeTop = Math.min(a.top, b.top)
            const left = Math.min(a.left, b.left)
            const right = Math.max(a.right, b.right)
            const mergeBottom = Math.max(a.bottom, b.bottom)
            return new DOMRect(left, mergeTop, right - left, mergeBottom - mergeTop)
          }
          let rect = merge()
          if (rect.bottom > limit - pad) {
            window.scrollBy(0, rect.bottom - (limit - pad))
            rect = merge()
          }
          if (rect.top < pad) {
            window.scrollBy(0, rect.top - pad)
            rect = merge()
          }
          const clipY = Math.max(0, rect.top - pad)
          const maxHeight = limit - clipY
          const clipHeight = Math.min(rect.height + pad * 2, maxHeight)
          return {
            x: Math.max(0, rect.left - pad),
            y: clipY,
            width: Math.min(rect.width + pad * 2, window.innerWidth - Math.max(0, rect.left - pad)),
            height: Math.max(1, clipHeight),
          }
        },
        { inset, pad: 12 },
      )
      const png = await page.screenshot({ animations: 'disabled', clip })
      writeFileSync(
        join(OUT, `purchase-vat-hidden-${theme}-${size.label}.png`),
        withPngSourceChunk(png, SCREENSHOT_SOURCE),
      )
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => window.scrollTo(0, 0))
}

async function preparePurchaseVatHiddenShot(page: Page, entity: string): Promise<void> {
  await setTaxCodeValidFrom(entity, 'VH21', '2025-01-01')
  await page.goto('/purchases/new')
  await hydrated(page)
  await page.getByLabel('Hun nummer', { exact: true }).fill('DEC-2025-VAT')
  await chooseOption(page, 'Leverancier', /Leverancier B\.V\./)
  await setBillDate(page, '2025-12-15')
  await page.getByLabel('Omschrijving regel 1').fill('Kantoor')
  await chooseOption(page, 'Grootboek regel 1', /^4400 /)
  await chooseOption(page, 'Btw-code regel 1', /^VH21/)
  await page.getByLabel('Excl. btw regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
  await page.getByLabel('Exclusief btw', { exact: true }).fill('100,00')
  await page.getByLabel('Btw', { exact: true }).fill('21,00')
  await page.getByLabel('Totaal', { exact: true }).fill('121,00')
  await setTaxCodeValidTo(entity, 'VH21', '2025-11-30')
  await expect(page.getByText('Boekjaar 2025 is nog niet geopend.')).toBeVisible()
  await expect(page.getByText('Kies een andere')).toHaveCount(0)
  await expect(page.getByLabel('Btw-code regel 1')).toContainText('VH21')
}

async function openBookYear(page: Page, code: string): Promise<void> {
  const opened = await page.request.post('/api/v1/fiscal-years', {
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    data: { code },
  })
  expect(opened.ok()).toBeTruthy()
}

test('capture #200 fiscal year booking gate screenshots', async ({ page, browser }) => {
  test.setTimeout(900_000)
  await ready(page)

  await page.goto('/purchases/new')
  await hydrated(page)
  await setBillDate(page, '2025-12-15')
  await expect(page.getByText('Boekjaar 2025 is nog niet geopend.')).toBeVisible()
  await expect(page.getByText('Kies een andere')).toHaveCount(0)
  await shoot(page, 'purchase-blocked')

  await preparePurchaseVatHiddenShot(page, await entityId(page))
  await shootPurchaseVatHidden(page)

  await shoot(page, 'purchase-date-hint', page.locator('#purchase-invoice-date-hint'))

  await page.goto('/invoices/new')
  await hydrated(page)
  await page.locator('#cust-q').fill('Klant')
  await page.getByRole('option', { name: 'Klant B.V.' }).click()
  await expect(page.getByText(/We vullen alvast in:/)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Verder/ }).click()
  await expect(page.getByText('Stap 2 van 4')).toBeVisible()
  await page.locator('#inv-date').fill('15-12-2025')
  await page.locator('#inv-date').blur()
  await expect(page.locator('#guided-invoice-date-hint')).toContainText(
    'Boekjaar 2025 is nog niet geopend.',
  )
  await shoot(page, 'invoice-blocked', page.locator('#guided-invoice-date-hint'))

  const owner = await browser.newContext()
  const auditor = await browser.newContext()
  try {
    const ownerPage = await owner.newPage()
    await ready(ownerPage)
    const auditorEmail = uniqueEmail()
    const auditorPage = await auditor.newPage()
    await installFiscalYearBookingFakeClock(auditorPage)
    await auditorPage.goto('/sign-in')
    await signIn(auditorPage, auditorEmail)
    await expect(auditorPage.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

    await ownerPage.goto('/members')
    const invite = ownerPage.locator('form', {
      has: ownerPage.getByRole('button', { name: 'Uitnodigen' }),
    })
    await invite.getByLabel('E-mail').fill(auditorEmail)
    await chooseOption(ownerPage, 'Rol', 'Controleur', invite)
    await ownerPage.getByRole('button', { name: 'Uitnodigen' }).click()
    await expect(ownerPage.getByText(new RegExp(`${auditorEmail} heeft nu toegang`))).toBeVisible()

    await auditorPage.reload()
    await expect(
      auditorPage.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
    ).toBeVisible({ timeout: 30_000 })
    await hydrated(auditorPage)
    await auditorPage.goto('/purchases/new')
    await hydrated(auditorPage)
    await setBillDate(auditorPage, '2025-12-15')
    await expect(auditorPage.getByRole('link', { name: 'Boekjaar 2025 openen' })).toHaveCount(0)
    await shoot(auditorPage, 'purchase-no-link', auditorPage.locator('#purchase-invoice-date-hint'))
  } finally {
    await owner.close()
    await auditor.close()
  }

  await page.goto('/fiscal-years')
  await hydrated(page)
  await expect(page.getByTestId('fiscal-years-open-section')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Boekjaar 2025 openen' })).toBeVisible()
  await shoot(page, 'fiscal-years-open-actions', page.getByTestId('fiscal-years-open-section'))

  await page.getByRole('button', { name: 'Boekjaar 2025 openen' }).click()
  await expect(page.getByTestId('open-prior-year')).toBeVisible()
  await shoot(page, 'fiscal-years-prior-expanded', page.getByTestId('fiscal-years-open-section'))

  await page.goto('/purchases/new')
  await hydrated(page)
  await setBillDate(page, '2025-12-15')
  await page.getByRole('link', { name: 'Boekjaar 2025 openen' }).click()
  await expect(page.getByTestId('open-prior-year')).toBeVisible()
  await expect(page.getByTestId('fixed-year-open-code')).toHaveText('2025')
  await page.getByRole('checkbox', { name: /Ik wil boekjaar 2025 openen/ }).check()
  const deeplinkPanel = page.getByTestId('open-prior-year')
  const confirmOpen = deeplinkPanel.getByRole('button', { name: 'Boekjaar 2025 openen' })
  await expect(confirmOpen).toBeEnabled()
  await page.getByRole('checkbox', { name: /Ik wil boekjaar 2025 openen/ }).focus()
  await page.keyboard.press('Tab')
  await expect(confirmOpen).toBeFocused()
  await shoot(page, 'fiscal-years-deeplink-confirm', deeplinkPanel)

  await confirmOpen.blur()
  await shoot(
    page,
    'fiscal-years-prior-confirm',
    deeplinkPanel.getByRole('button', { name: 'Boekjaar 2025 openen' }),
  )

  await page.getByRole('button', { name: 'Boekjaar 2025 openen' }).click()
  await expect(page).toHaveURL(/\/purchases\/new/, { timeout: 30_000 })
  await expect(page.getByLabel('Factuurdatum', { exact: true })).toHaveValue('2025-12-15')
  await shoot(page, 'purchase-returned', page.getByLabel('Factuurdatum', { exact: true }))

  await openBookYear(page, '2024')
  await page.goto('/fiscal-years')
  await hydrated(page)
  const pluralHint = page.getByTestId('fiscal-year-prior-not-closed-hint').filter({
    hasText:
      'Boekjaren 2024 en 2025 zijn nog niet afgesloten; de resultaten staan nog niet in de beginbalans van 2026.',
  })
  await expect(pluralHint).toBeVisible()
  await shoot(page, 'fiscal-years-list', pluralHint)

  await shoot(page, 'fiscal-years-next-card', page.getByTestId('fiscal-years-open-section'))
})

test('capture purchase-vat-hidden PNGs only', async ({ page }) => {
  test.skip(
    !CAPTURE || process.env['CAPTURE_VAT_HIDDEN_ONLY'] !== '1',
    'Set CAPTURE_PR_SCREENSHOTS=1 and CAPTURE_VAT_HIDDEN_ONLY=1',
  )
  test.setTimeout(120_000)
  await ready(page)
  await preparePurchaseVatHiddenShot(page, await entityId(page))
  await shootPurchaseVatHidden(page)
})
