import { expect, test, type Page } from '@playwright/test'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import { chooseOption, DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'
import {
  FISCAL_YEAR_BOOKING_E2E_TODAY,
  FISCAL_YEAR_BOOKING_FAKE_CLOCK,
  installFiscalYearBookingFakeClock,
} from './support/fiscal-year-booking-fake-clock'

type SqlTag = {
  <T = unknown>(strings: TemplateStringsArray, ...values: readonly unknown[]): Promise<T>
}

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function setBillDate(page: Page, isoDate: string): Promise<void> {
  const field = page.getByLabel('Factuurdatum', { exact: true })
  await field.click()
  await field.fill(isoDate)
  await expect(field).toHaveValue(isoDate)
}

test.use({ timezoneId: 'Europe/Amsterdam' })

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

async function ready(page: Page): Promise<void> {
  await installFiscalYearBookingFakeClock(page)
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.goto('/setup')
  await page.getByLabel('Naam', { exact: true }).fill('Fiscale Poort BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
  await aSupplier(page)
}

async function entityId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/entity')
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { id: string }
  return body.id
}

async function countBookYearRows(
  page: Page,
  code: string,
): Promise<{ fiscalYears: number; periods: number; journalEntries: number }> {
  const id = await entityId(page)
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const sql = (database as unknown as { $client: SqlTag }).$client
  try {
    const [years] = await sql<{ count: string }[]>`
      select count(*)::text as count
      from klopt.fiscal_years
      where entity_id = ${id}::uuid and code = ${code}
    `
    const [periods] = await sql<{ count: string }[]>`
      select count(*)::text as count
      from klopt.periods p
      inner join klopt.fiscal_years fy on fy.id = p.fiscal_year_id
      where fy.entity_id = ${id}::uuid and fy.code = ${code}
    `
    const [entries] = await sql<{ count: string }[]>`
      select count(*)::text as count
      from klopt.journal_entries
      where entity_id = ${id}::uuid
    `
    return {
      fiscalYears: Number(years?.count ?? 0),
      periods: Number(periods?.count ?? 0),
      journalEntries: Number(entries?.count ?? 0),
    }
  } finally {
    await closeDatabase(database)
  }
}

test('fake clock is 15 January before booking-gate scenarios run', async ({ page }) => {
  await installFiscalYearBookingFakeClock(page)
  await ready(page)
  const seen = await page.evaluate(() => new Date().toISOString())
  expect(seen.startsWith('2026-01-15')).toBe(true)
  expect(FISCAL_YEAR_BOOKING_E2E_TODAY).toBe('2026-01-15')
  expect(FISCAL_YEAR_BOOKING_FAKE_CLOCK.startsWith('2026-01-15')).toBe(true)
})

test('prior-year bill shows book-year message, not VAT date hint', async ({ page }) => {
  await ready(page)

  await page.goto('/purchases/new')
  await hydrated(page)
  await setBillDate(page, '2025-12-15')

  await expect(page.getByText('Boekjaar 2025 is nog niet geopend.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Boekjaar 2025 openen' })).toBeVisible()
  await expect(page.getByText('Kies een andere')).toHaveCount(0)
  await expect(page.getByText('geldt niet op deze datum')).toHaveCount(0)
})

test('opening the year returns to the draft with the date intact', async ({ page }) => {
  await ready(page)

  await page.goto('/purchases/new')
  await hydrated(page)
  await page.getByLabel('Hun nummer', { exact: true }).fill('DEC-2025-01')
  await setBillDate(page, '2025-12-15')

  await page.getByRole('link', { name: 'Boekjaar 2025 openen' }).click()
  await expect(page.getByRole('heading', { name: 'Boekjaren' })).toBeVisible()

  await page.getByRole('checkbox', { name: /Ik wil boekjaar 2025 openen/ }).check()
  await page.getByRole('button', { name: 'Boekjaar 2025 openen' }).click()
  await expect(page).toHaveURL(/\/purchases\/new/, { timeout: 30_000 })
  await expect(page.getByLabel('Factuurdatum', { exact: true })).toHaveValue('2025-12-15')
  await expect(page.getByLabel('Hun nummer', { exact: true })).toHaveValue('DEC-2025-01')
})

test('prior-year confirm offers only earliest open year minus one, with no year field', async ({
  page,
}) => {
  await ready(page)

  await page.goto('/fiscal-years')
  await hydrated(page)
  await page.getByRole('button', { name: 'Boekjaar 2025 openen' }).click()

  const panel = page.getByTestId('open-prior-year')
  await expect(panel.getByTestId('fixed-year-open-code')).toHaveText('2025', {
    timeout: 10_000,
  })
  await expect(panel.locator('input[maxlength="4"]')).toHaveCount(0)
  await expect(page.locator('input[inputmode="numeric"][maxlength="4"]')).toHaveCount(1)
  await expect(panel.getByText('Er wordt geen beginbalans aangemaakt')).toBeVisible()
})

test('at book-year floor 1960, prior-year opening is not offered', async ({ page }) => {
  await ready(page)

  const opened = await page.request.post('/api/v1/fiscal-years', {
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    data: { code: '1960' },
  })
  expect(opened.ok()).toBeTruthy()

  await page.goto('/fiscal-years')
  await expect(page.getByRole('button', { name: 'Boekjaar 1959 openen' })).toHaveCount(0)
  await expect(page.getByTestId('open-prior-year')).toHaveCount(0)
})

test('double submit on prior-year confirm creates one book year, twelve periods, no entries', async ({
  page,
}) => {
  await ready(page)

  const before = await countBookYearRows(page, '2025')
  expect(before).toEqual({ fiscalYears: 0, periods: 0, journalEntries: 0 })

  await page.goto('/fiscal-years?openYear=2025&focus=confirm')
  await hydrated(page)
  const ack = page.getByRole('checkbox', { name: /Ik wil boekjaar 2025 openen/ })
  await ack.check()
  await expect(ack).toBeChecked()
  const confirm = page.getByRole('button', { name: 'Boekjaar 2025 openen' })
  await Promise.all([confirm.click(), confirm.click()])
  await expect
    .poll(async () => (await countBookYearRows(page, '2025')).fiscalYears, {
      timeout: 45_000,
    })
    .toBe(1)
  await expect(page.getByText(/Boekjaar 2025 staat open/)).toBeVisible()

  const after = await countBookYearRows(page, '2025')
  expect(after.fiscalYears).toBe(1)
  expect(after.periods).toBe(12)
  expect(after.journalEntries).toBe(0)

  const listed = await page.request.get('/api/v1/fiscal-years')
  expect(listed.ok()).toBeTruthy()
  const body = (await listed.json()) as { fiscalYears: { code: string }[] }
  expect(body.fiscalYears.filter((year) => year.code === '2025')).toHaveLength(1)
})

test('out-of-range book year is refused on the server', async ({ page }) => {
  await ready(page)
  const response = await page.request.post('/api/v1/fiscal-years', {
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    data: { code: '1925' },
  })
  expect(response.status()).toBe(422)
})

test('a role without ledger:configure sees the message but no open link', async ({ browser }) => {
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
    await expect(auditorPage.getByText('Boekjaar 2025 is nog niet geopend.')).toBeVisible()
    await expect(auditorPage.getByRole('link', { name: 'Boekjaar 2025 openen' })).toHaveCount(0)
    await expect(
      auditorPage.getByText(/eigenaar, accountant of boekhouder kan het openen/i),
    ).toBeVisible()
  } finally {
    await owner.close()
    await auditor.close()
  }
})

async function openBookYear(page: Page, code: string): Promise<void> {
  const opened = await page.request.post('/api/v1/fiscal-years', {
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    data: { code },
  })
  expect(opened.ok()).toBeTruthy()
}

test('Boekjaren notes when an earlier year is still open', async ({ page }) => {
  await ready(page)
  await openBookYear(page, '2025')

  await page.goto('/fiscal-years')
  await hydrated(page)

  const hint = page.getByTestId('fiscal-year-prior-not-closed-hint')
  await expect(hint).toHaveCount(1)
  await expect(hint).toContainText('Boekjaar 2025 is nog niet afgesloten')
  await expect(hint).toContainText('beginbalans van 2026')
  const row2025 = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: '2025', exact: true }),
  })
  await expect(row2025.getByTestId('fiscal-year-prior-not-closed-hint')).toHaveCount(0)
})

test('Boekjaren omits the note when only the earliest year exists', async ({ page }) => {
  await ready(page)
  await page.goto('/fiscal-years')
  await hydrated(page)
  await expect(page.getByTestId('fiscal-year-prior-not-closed-hint')).toHaveCount(0)
})

test('Boekjaren ignores an openYear the screen does not offer', async ({ page }) => {
  await ready(page)

  await page.goto('/fiscal-years?openYear=2030&focus=confirm')
  await hydrated(page)

  await expect(page.getByTestId('open-prior-year')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /Ik wil boekjaar 2030/ })).toHaveCount(0)
  await expect(page.getByTestId('fiscal-years-open-section')).toBeVisible()
  await expect(page.getByTestId('derived-dates')).toContainText('2027')
})

test('Boekjaren ignores out-of-range openYear values', async ({ page }) => {
  await ready(page)

  for (const year of ['1959', '2101'] as const) {
    await page.goto(`/fiscal-years?openYear=${year}&focus=confirm`)
    await hydrated(page)
    await expect(page.getByTestId('open-prior-year')).toHaveCount(0)
    await expect(
      page.getByRole('checkbox', { name: new RegExp(`boekjaar ${year}`, 'i') }),
    ).toHaveCount(0)
  }
})

test('a gap book year shows the message without an open link', async ({ page }) => {
  await ready(page)
  await openBookYear(page, '2024')

  await page.goto('/purchases/new')
  await hydrated(page)
  await setBillDate(page, '2025-06-01')

  await expect(page.getByText('Boekjaar 2025 is nog niet geopend.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Boekjaar 2025 openen' })).toHaveCount(0)
})

test('Boekjaren names every earlier open year on the next row', async ({ page }) => {
  await ready(page)
  await openBookYear(page, '2024')
  await openBookYear(page, '2025')

  await page.goto('/fiscal-years')
  await hydrated(page)

  await expect(
    page.getByTestId('fiscal-year-prior-not-closed-hint').filter({
      hasText:
        'Boekjaren 2024 en 2025 zijn nog niet afgesloten; de resultaten staan nog niet in de beginbalans van 2026.',
    }),
  ).toBeVisible()
})
