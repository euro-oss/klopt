import { expect, test, type Locator, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { todayInAmsterdam } from '../src/lib/amsterdam-date.js'
import {
  CONTACTS_OVERDUE_CALENDAR_PROOF_DATES,
  contactsOverdueFixtureDates,
  contactsOverdueNeedsPriorFiscalYear,
  customerNotYetDueIssueDate,
  ensurePriorFiscalYearOpen,
  installWallClock,
  OVERDUE_CUSTOMER_PAYMENT_TERMS_DAYS,
  type ContactsOverdueFixtureDates,
} from './support/contacts-overdue-fixture-dates.js'
import {
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  signIn,
  uniqueEmail,
} from './support'

/**
 * #195 item 1 — open amount ink by default; red only when contact has overdue sales or purchase bills.
 */

test.use({ timezoneId: 'Europe/Amsterdam' })

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function expectOpenInk(openLocator: Locator): Promise<void> {
  await expect(openLocator).toHaveClass(/text-ink/)
  await expect(openLocator).not.toHaveClass(/text-destructive/)
  await expect(openLocator).not.toHaveClass(/text-ink-muted/)
}

async function openAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Open Kleur Test BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
}

async function bookOverduePurchaseInPriorYearWhenNeeded(
  page: Page,
  dates: ContactsOverdueFixtureDates,
  run: () => Promise<void>,
): Promise<void> {
  if (!contactsOverdueNeedsPriorFiscalYear(dates.asOf)) {
    await run()
    return
  }
  const currentYear = dates.asOf.slice(0, 4)
  const prior = String(Number(currentYear) - 1)
  await ensurePriorFiscalYearOpen(page, dates.asOf)
  await page.goto('/')
  await hydrated(page)
  await chooseOption(page, 'Boekjaar', new RegExp(`^${prior}`))
  try {
    await run()
  } finally {
    await page.goto('/')
    await hydrated(page)
    await chooseOption(page, 'Boekjaar', new RegExp(`^${currentYear}`))
  }
}

async function seedEntityForSales(page: Page): Promise<void> {
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
}

async function seedCustomer(
  page: Page,
  number: string,
  name: string,
  paymentTermsDays?: number,
): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill(number)
  await page.getByLabel('Naam', { exact: true }).fill(name)
  await page.getByLabel('E-mail').fill('facturen@example.nl')
  if (paymentTermsDays !== undefined) {
    await page.getByLabel('Betalingstermijn').fill(String(paymentTermsDays))
  }
  await page.getByLabel('Straat').fill('Demoweg')
  await page.getByLabel('Huisnr.').fill('10')
  await page.getByLabel('Postcode').fill('1000 AA')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible()
}

async function seedSupplier(page: Page, number: string, name: string): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill(number)
  await page.getByLabel('Naam', { exact: true }).fill(name)
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL000001950B99')
  await page.getByLabel('E-mail').fill('inkoop@example.nl')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('checkbox', { name: /Klant/ }).uncheck()
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible()
}

async function issueInvoice(page: Page, customer: RegExp, issueDate?: string): Promise<void> {
  await page.goto('/invoices/new')
  await page.getByRole('combobox', { name: 'Klant' }).click()
  await page.getByRole('option', { name: customer }).click()
  if (issueDate !== undefined) {
    await page.getByLabel('Factuurdatum').fill(issueDate)
  }
  await page.getByLabel('Omschrijving regel 1').fill('Advies')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Eenheid regel 1').fill('EA')
  await page.getByLabel('Prijs regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('heading', { name: /Factuur \d{4}-/ })).toBeVisible()
}

async function bookSupplierBill(
  page: Page,
  opts: { number: string; invoiceDate: string; dueDate: string },
): Promise<void> {
  await page.goto('/purchases/new')
  await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
  await page.getByLabel('Hun nummer').fill(opts.number)
  await page.getByLabel('Factuurdatum').fill(opts.invoiceDate)
  await page.getByLabel('Vervaldatum').fill(opts.dueDate)
  await page.getByLabel('Exclusief btw', { exact: true }).fill('100,00')
  await page.getByLabel('Btw', { exact: true }).fill('21,00')
  await page.getByLabel('Totaal', { exact: true }).fill('121,00')
  await page.getByLabel('Omschrijving regel 1').fill('Inkoop demo')
  await chooseOption(page, 'Grootboek regel 1', /^4400 /)
  await page.getByLabel('Excl. btw regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Boeken', exact: true }).click()
  await expect(page.getByRole('link', { name: /^boeking \d/ })).toBeVisible()
  await page.getByRole('button', { name: 'Goedkeuren voor betaling' }).click()
  await expect(page.getByText('goedgekeurd voor betaling')).toBeVisible()
}

async function runCustomerOpenOverdueScenario(
  page: Page,
  dates: ContactsOverdueFixtureDates,
): Promise<void> {
  await openAdmin(page)
  await seedEntityForSales(page)
  await seedCustomer(page, 'DEB-1950', 'Stilte Niets Open')
  await seedCustomer(page, 'DEB-1952', 'Windvaan Open Kleur')
  await issueInvoice(page, /Windvaan Open Kleur/, customerNotYetDueIssueDate(dates))

  await page.setViewportSize({ width: 1440, height: 1040 })
  await page.goto('/contacts')
  await hydrated(page)

  const emptyRow = page.getByRole('button', { name: /Stilte Niets Open/ })
  const emptyListOpen = emptyRow.locator('[data-contacts-list-open-amount]:visible')
  await expect(emptyListOpen).toHaveClass(/text-ink-muted/)
  await expect(emptyListOpen).toHaveText('–')

  await page.getByRole('button', { name: /Windvaan Open Kleur/ }).click()

  const card = page.getByRole('complementary', { name: 'Relatiekaart' })
  await expect(card).toBeVisible()
  const cardOpen = card.locator('[data-contact-open-amount]')
  await expect(cardOpen).toHaveAttribute('data-contact-open-overdue', 'false')
  await expectOpenInk(cardOpen)

  const listRow = page.getByRole('button', { name: /Windvaan Open Kleur/ })
  const listOpen = listRow.locator('[data-contacts-list-open-amount]:visible')
  await expect(listOpen).toHaveAttribute('data-contacts-open-overdue', 'false')
  await expectOpenInk(listOpen)
  await expect(listRow.getByText(/dagen te laat|dag te laat/i)).toHaveCount(0)

  await seedCustomer(page, 'DEB-1953', 'Klif Te Laat Demo', OVERDUE_CUSTOMER_PAYMENT_TERMS_DAYS)
  if (dates.asOf === dates.fiscalYearStart) {
    // No in-year sales invoice can be overdue on the first calendar day of the book year.
    return
  }
  await issueInvoice(page, /Klif Te Laat Demo/, dates.customerOverdueIssueDate())

  await page.goto('/contacts')
  await hydrated(page)
  await page.getByRole('button', { name: /Klif Te Laat Demo/ }).click()
  const overdueCard = page.getByRole('complementary', { name: 'Relatiekaart' })
  await expect(overdueCard.locator('[data-contact-open-amount]')).toHaveAttribute(
    'data-contact-open-overdue',
    'true',
  )
  await expect(overdueCard.locator('[data-contact-open-amount]')).toHaveClass(/text-destructive/)

  const overdueRow = page.getByRole('button', { name: /Klif Te Laat Demo/ })
  const overdueListOpen = overdueRow.locator('[data-contacts-list-open-amount]:visible')
  await expect(overdueListOpen).toHaveAttribute('data-contacts-open-overdue', 'true')
  await expect(overdueListOpen).toHaveClass(/text-destructive/)
  await expect(overdueCard.getByText(/dagen te laat|dag te laat/i)).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/contacts')
  await expect(page.getByRole('button', { name: /Klif Te Laat Demo/ })).toBeVisible()
  const overdueRowMobile = page.getByRole('button', { name: /Klif Te Laat Demo/ })
  await expect(overdueRowMobile.getByText(/dagen te laat|dag te laat/i)).toBeVisible()
  const mobileOpen = overdueRowMobile.locator('[data-contacts-list-open-amount]:visible')
  await expect(mobileOpen).toHaveAttribute('data-contacts-open-overdue', 'true')
  await expect(mobileOpen).toHaveClass(/text-destructive/)

  const emptyRowMobile = page.getByRole('button', { name: /Stilte Niets Open/ })
  const emptyMobileOpen = emptyRowMobile.locator('[data-contacts-list-open-amount]:visible')
  await expect(
    emptyMobileOpen.locator('span.text-ink-muted', { hasText: 'Niets open' }),
  ).toBeVisible()
}

async function runSupplierOpenOverdueScenario(
  page: Page,
  dates: ContactsOverdueFixtureDates,
): Promise<void> {
  await openAdmin(page)
  await seedEntityForSales(page)
  await seedSupplier(page, 'LEV-1954', 'Leverancier Kleur Proef')
  const notYetDue = dates.notYetDuePurchaseBill()
  await bookSupplierBill(page, {
    number: 'F-1954-future',
    invoiceDate: notYetDue.invoiceDate,
    dueDate: notYetDue.dueDate,
  })

  await page.setViewportSize({ width: 1440, height: 1040 })
  await page.goto('/contacts')
  await hydrated(page)
  await page.getByRole('button', { name: /Leverancier Kleur Proef/ }).click()

  const card = page.getByRole('complementary', { name: 'Relatiekaart' })
  const cardOpen = card.locator('[data-contact-open-amount]')
  await expect(cardOpen).toHaveAttribute('data-contact-open-overdue', 'false')
  await expectOpenInk(cardOpen)

  const listRow = page.getByRole('button', { name: /Leverancier Kleur Proef/ })
  const listOpen = listRow.locator('[data-contacts-list-open-amount]:visible')
  await expectOpenInk(listOpen)

  if (contactsOverdueNeedsPriorFiscalYear(dates.asOf)) {
    return
  }

  const overdue = dates.overduePurchaseBill()
  await bookOverduePurchaseInPriorYearWhenNeeded(page, dates, async () => {
    await bookSupplierBill(page, {
      number: 'F-1954-late',
      invoiceDate: overdue.invoiceDate,
      dueDate: overdue.dueDate,
    })
  })

  await page.goto('/contacts')
  await hydrated(page)
  await page.getByRole('button', { name: /Leverancier Kleur Proef/ }).click()

  await expect(card.locator('[data-contact-open-amount]')).toHaveAttribute(
    'data-contact-open-overdue',
    'true',
  )
  await expect(card.locator('[data-contact-open-amount]')).toHaveClass(/text-destructive/)

  const listOpenLate = listRow.locator('[data-contacts-list-open-amount]:visible')
  await expect(listOpenLate).toHaveClass(/text-destructive/)
}

test('not-yet-due open amount is ink on list and card; overdue is red; Niets open stays muted', async ({
  page,
}) => {
  await runCustomerOpenOverdueScenario(page, contactsOverdueFixtureDates(todayInAmsterdam()))
})

test('supplier open amount: not-yet-due bill is ink; overdue bill is red (purchase due dates)', async ({
  page,
}) => {
  await runSupplierOpenOverdueScenario(page, contactsOverdueFixtureDates(todayInAmsterdam()))
})

test.describe('fake wall clock — calendar-stable fixture dates', () => {
  test.describe.configure({ mode: 'serial' })

  for (const asOf of CONTACTS_OVERDUE_CALENDAR_PROOF_DATES) {
    test.describe(`as-of ${asOf}`, () => {
      test.use({ extraHTTPHeaders: { 'X-Klopt-E2e-As-Of': asOf } })

      test('customer styling', async ({ page }) => {
        await installWallClock(page, asOf)
        await runCustomerOpenOverdueScenario(page, contactsOverdueFixtureDates(asOf))
      })

      test('supplier styling', async ({ page }) => {
        await installWallClock(page, asOf)
        await runSupplierOpenOverdueScenario(page, contactsOverdueFixtureDates(asOf))
      })
    })
  }
})
