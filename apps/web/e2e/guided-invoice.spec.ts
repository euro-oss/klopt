import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeDatabase, createDatabase, membershipsFor, runMigrations } from '@klopt/db'
import { findUserIdByEmail } from '@klopt/db/testing'
import { DATABASE_URL, enableAdvancedMode, hydrated, OUTBOX, signIn, uniqueEmail } from './support'

type PostgresSql = {
  unsafe: (query: string, params?: unknown[]) => Promise<unknown>
}

/**
 * Guided sales invoice (#45 / redesign slice 5).
 *
 * Eigenaar with Geavanceerd off walks Klant → Wat lever je → Controleren →
 * Versturen with the keyboard. No ledger account or VAT code is shown.
 */

/**
 * Sales VAT codes and revenue ledger numbers that must never leak into
 * simple mode (PM #74 item 5 / #45 AC). VH* are purchase codes — kept so a
 * stray purchase picker still fails the check.
 */
const LEAK = /\b(?:H21|L9|VERL|GEEN|NUL|ICP|ICPD|PRIV21|VH21|VH9|8000|8010)\b/

async function expectNoCodes(page: Page): Promise<void> {
  await expect(page.getByText(/journaalpost/i)).toHaveCount(0)
  await expect(page.getByText(LEAK)).toHaveCount(0)
}

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  rmSync(OUTBOX, { recursive: true, force: true })
})

async function administrationReady(page: Page, name: string): Promise<string> {
  const email = uniqueEmail()
  await page.goto('/sign-in')
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await hydrated(page)

  await page.goto('/settings')
  await page.getByLabel('Straat').fill('Lange Delft')
  await page.getByLabel('Huisnummer').fill('41')
  await page.getByLabel('Postcode').fill('4331 JC')
  await page.getByLabel('Plaats').fill('Middelburg')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('61234567')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL861234567B01')
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()
  return email
}

async function addCustomer(page: Page, opts: { email?: string | null } = {}): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Hotel Zeezicht B.V.')
  // Peppol/UBL needs buyer KvK (electronic address defaults to it).
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL987654321B01')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('87654321')
  if (opts.email !== null) {
    await page.getByLabel('E-mail').fill(opts.email ?? 'administratie@hotelzeezicht.nl')
  }
  await page.getByLabel('Straat').fill('Boulevard de Ruyter')
  await page.getByLabel('Huisnr.').fill('2')
  await page.getByLabel('Postcode').fill('4381 KA')
  await page.getByLabel('Plaats').fill('Vlissingen')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Hotel Zeezicht B.V.' })).toBeVisible()
}

async function fillBreadLine(page: Page): Promise<void> {
  await page.getByLabel('Omschrijving regel 1').fill('Desembroden, week 41')
  await page.getByLabel('Aantal regel 1').fill('60')
  await page.getByLabel('Prijs regel 1').fill('4,20')
}

/** 60 × €4,20 at 21% (H21 / per-invoice) = €304,92. NBSP-only (formatEuro). */
const EXPECTED_TOTAL = /€\u00a0304,92/
/** After orphan-draft edit: 50 × €4,20 at 21% = €254,10. */
const EDITED_TOTAL = /€\u00a0254,10/

async function waitForOutboxTo(email: string): Promise<string> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const files = existsSync(OUTBOX)
      ? readdirSync(OUTBOX).filter((name) => name.endsWith('.txt'))
      : []
    for (const name of files.sort().reverse()) {
      const message = readFileSync(join(OUTBOX, name), 'utf8')
      if (message.includes(`To: ${email}`) && /Factuur/i.test(message)) return message
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`No invoice email was delivered to ${email}.`)
}

test('Eigenaar finishes the guided invoice with the keyboard and never sees a ledger code', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await administrationReady(page, 'Guided Factuur BV')
  await addCustomer(page)

  await page.goto('/invoices/new')
  await expect(page.getByRole('heading', { name: 'Nieuwe factuur' })).toBeVisible()
  await expect(page.locator('#cust-q')).not.toBeFocused()
  await expect(page.getByText('Stap 1 van 4')).toBeVisible()
  await expectNoCodes(page)

  // Step 1 — keyboard search selects the match; Verder advances.
  await page.locator('#cust-q').pressSequentially('Hotel', { delay: 30 })
  await expect(page.getByRole('option', { name: /Hotel Zeezicht/ })).toBeVisible()
  await expect(page.getByText(/We vullen alvast in:/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Vlissingen').first()).toBeVisible()
  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await expect(page.getByText('Stap 2 van 4')).toBeVisible()

  await fillBreadLine(page)
  const vatSelect = page.getByLabel('Btw regel 1')
  await expect(vatSelect).toBeVisible()
  await expect(vatSelect.locator('option:checked')).toContainText(/21% btw/)
  await expectNoCodes(page)
  // Distinct zero-rate labels, not five identical "Geen btw".
  const options = await vatSelect.locator('option').allTextContents()
  expect(options.some((label) => /verlegd/i.test(label))).toBe(true)
  expect(options.some((label) => /vrijgesteld/i.test(label))).toBe(true)
  expect(options.filter((label) => label === 'Geen btw')).toHaveLength(0)

  // Tab to the primary CTA and press Enter (no mouse).
  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await expect(page.getByText('Stap 3 van 4')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Wat er gebeurt')).toBeVisible()
  // Server draft total on Controleren (60 × €4,20 + 21%).
  await expect(page.getByText(EXPECTED_TOTAL).first()).toBeVisible()
  await expectNoCodes(page)

  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await expect(page.getByText('Stap 4 van 4')).toBeVisible()
  await expect(page.getByRole('radio', { name: /Per e-mail/ })).toBeVisible()
  await expectNoCodes(page)

  await page.getByRole('button', { name: /^Versturen/ }).press('Enter')
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Factuur versturen?')).toBeVisible()
  await expect(dialog.getByText(EXPECTED_TOTAL)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await page.getByRole('button', { name: /^Versturen/ }).press('Enter')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /^Versturen/ }).press('Enter')

  // (b)+(c) — emailed success only (not the PDF "Klaar voor" heading), with server total.
  await expect(page.getByRole('heading', { name: /Verstuurd naar Hotel Zeezicht/ })).toBeVisible({
    timeout: 45_000,
  })
  await expect(page.getByRole('heading', { name: /Klaar voor/ })).toHaveCount(0)
  await expect(page.getByText(/Factuur \d{4}-\d+/)).toBeVisible()
  await expect(page.getByText(EXPECTED_TOTAL)).toBeVisible()
  await expectNoCodes(page)
  const delivered = await waitForOutboxTo('administratie@hotelzeezicht.nl')
  expect(delivered).toContain('To: administratie@hotelzeezicht.nl')
  expect(delivered).toMatch(/Factuur/i)
})

test('validation errors, Concept opslaan and the PDF path', async ({ page }) => {
  await administrationReady(page, 'Guided Validatie BV')
  await addCustomer(page, { email: null })

  await page.goto('/invoices/new')
  // No match → needCustomer (avoid fill()'s clear step, which auto-picks everyone).
  await page.locator('#cust-q').pressSequentially('zzzz-geen-klant', { delay: 20 })
  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await expect(page.getByText('Kies eerst een klant.')).toBeVisible()

  await page.locator('#cust-q').fill('Hotel')
  await page.getByRole('option', { name: /Hotel Zeezicht/ }).press('Enter')
  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await expect(page.getByText('Stap 2 van 4')).toBeVisible()
  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await expect(
    page.getByText('Vul minstens één regel met omschrijving en bedrag in.'),
  ).toBeVisible()

  await fillBreadLine(page)
  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await expect(page.getByText('Stap 3 van 4')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await expect(page.getByText('Stap 4 van 4')).toBeVisible()

  // No e-mail → PDF is the default.
  await expect(page.getByRole('radio', { name: /Zelf versturen/ })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  // (a) Concept opslaan → draft with no number allocated.
  await page.getByRole('button', { name: /Concept opslaan/ }).press('Enter')
  await expect(page.getByRole('heading', { name: /Factuur Concept/ })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText(/Concept\./)).toBeVisible()
  await expect(page.getByText(/Nog geen nummer/)).toBeVisible()
  await expect(page.getByText(/Factuur \d{4}-\d+/)).toHaveCount(0)
  // Draft detail uses Money (no € prefix); 60 × €4,20 + 21% = 30492 minor.
  // (Detail page may show bookkeeper codes — that is not the guided flow.)
  await expect(page.locator('[data-minor-units="30492"]').first()).toBeVisible()
})

test('PDF send path reaches Klaar voor without claiming e-mail', async ({ page }) => {
  await administrationReady(page, 'Guided Pdf BV')
  await addCustomer(page)

  await page.goto('/invoices/new')
  await page.locator('#cust-q').pressSequentially('Hotel', { delay: 30 })
  await expect(page.getByRole('option', { name: /Hotel Zeezicht/ })).toBeVisible()
  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await expect(page.getByText('Stap 2 van 4')).toBeVisible()
  await fillBreadLine(page)
  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await expect(page.getByText('Stap 3 van 4')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await page.getByRole('radio', { name: /Zelf versturen/ }).click()
  await page.getByRole('button', { name: /^Versturen/ }).press('Enter')
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /^Versturen/ })
    .press('Enter')
  // PDF path — issued but not e-mailed; must not claim Verstuurd.
  await expect(page.getByRole('heading', { name: /Klaar voor Hotel Zeezicht/ })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('heading', { name: /Verstuurd naar/ })).toHaveCount(0)
  await expect(page.getByText(EXPECTED_TOTAL)).toBeVisible()
  await expectNoCodes(page)
})

test('Controleren → Terug → edit → Controleren keeps one draft id', async ({ page }) => {
  test.setTimeout(90_000)
  await administrationReady(page, 'Guided Orphan BV')
  await addCustomer(page)

  await page.goto('/invoices/new')
  await expect(page.getByRole('heading', { name: 'Nieuwe factuur' })).toBeVisible()
  await hydrated(page)
  // Keyboard pick: Enter on the highlighted option selects it (combobox).
  await page.getByRole('option', { name: /Hotel Zeezicht/ }).press('Enter')
  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await expect(page.getByText('Stap 2 van 4')).toBeVisible()
  await fillBreadLine(page)
  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await expect(page.getByText('Stap 3 van 4')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(EXPECTED_TOTAL).first()).toBeVisible()

  const firstList = await page.request.get('/api/v1/sales-invoices?status=draft')
  expect(firstList.ok()).toBe(true)
  const firstBody = (await firstList.json()) as { invoices: { id: string; total: string }[] }
  expect(firstBody.invoices).toHaveLength(1)
  const draftId = firstBody.invoices[0]!.id
  expect(firstBody.invoices[0]!.total).toBe('30492')

  // Enter on Terug goes back (must not be captured as goNext).
  await page.getByRole('button', { name: /Terug/ }).press('Enter')
  await expect(page.getByText('Stap 2 van 4')).toBeVisible()
  await page.getByLabel('Aantal regel 1').fill('50')
  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await expect(page.getByText('Stap 3 van 4')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(EDITED_TOTAL).first()).toBeVisible()

  const secondList = await page.request.get('/api/v1/sales-invoices?status=draft')
  expect(secondList.ok()).toBe(true)
  const secondBody = (await secondList.json()) as { invoices: { id: string; total: string }[] }
  expect(secondBody.invoices).toHaveLength(1)
  expect(secondBody.invoices[0]!.id).toBe(draftId)
  expect(secondBody.invoices[0]!.total).toBe('25410')

  await page.getByRole('button', { name: /Verder/ }).press('Enter')
  await page.getByRole('button', { name: /^Versturen/ }).press('Enter')
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /^Versturen/ })
    .press('Enter')
  await expect(page.getByRole('heading', { name: /Verstuurd naar Hotel Zeezicht/ })).toBeVisible({
    timeout: 45_000,
  })
  await expect(page.getByText(EDITED_TOTAL)).toBeVisible()

  const issued = await page.request.get(`/api/v1/sales-invoices/${draftId}`)
  expect(issued.ok()).toBe(true)
  const issuedBody = (await issued.json()) as {
    invoice: { id: string; status: string; total: string }
  }
  expect(issuedBody.invoice.id).toBe(draftId)
  expect(issuedBody.invoice.status).toBe('issued')
  expect(issuedBody.invoice.total).toBe('25410')

  const draftsLeft = await page.request.get('/api/v1/sales-invoices?status=draft')
  expect(draftsLeft.ok()).toBe(true)
  const draftsBody = (await draftsLeft.json()) as { invoices: unknown[] }
  expect(draftsBody.invoices).toHaveLength(0)
})

test('a hard-closed period keeps the user in the flow with named copy', async ({ page }) => {
  const email = await administrationReady(page, 'Guided Periode BV')
  await addCustomer(page)

  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  try {
    const userId = await findUserIdByEmail(database, email)
    if (userId === null) throw new Error('missing user')
    const memberships = await membershipsFor(database, userId)
    const entityId = memberships[0]?.entityId
    if (entityId === undefined) throw new Error('missing entity')

    // Close the month that contains today's date (UTC) — a single month, not a quarter.
    const today = new Date().toISOString().slice(0, 10)
    const year = Number(today.slice(0, 4))
    const month = Number(today.slice(5, 7))
    const client = (database as unknown as { $client: PostgresSql }).$client
    await client.unsafe(
      `update klopt.periods set status = 'hard_closed' where entity_id = $1::uuid and sequence = $2`,
      [entityId, month],
    )

    await page.goto('/invoices/new')
    await page.locator('#cust-q').pressSequentially('Hotel', { delay: 30 })
    await expect(page.getByRole('option', { name: /Hotel Zeezicht/ })).toBeVisible()
    await page.getByRole('button', { name: /Verder/ }).press('Enter')
    await expect(page.getByText('Stap 2 van 4')).toBeVisible()
    await fillBreadLine(page)
    await page.getByRole('button', { name: /Verder/ }).press('Enter')
    await expect(page.getByText('Stap 3 van 4')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /Verder/ }).press('Enter')
    await page.getByRole('button', { name: /^Versturen/ }).press('Enter')
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /^Versturen/ })
      .press('Enter')

    // (d) Stay in the flow with month-named hard-closed copy (not Qn); no "heropen".
    await expect(page.getByText('Stap 2 van 4')).toBeVisible({ timeout: 15_000 })
    const monthLabel = new Intl.DateTimeFormat('nl-NL', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, 1)))
    await expect(page.getByText(`${monthLabel} is definitief afgesloten`)).toBeVisible()
    await expect(page.getByText(/Q\d/)).toHaveCount(0)
    await expect(page.getByText(/heropen/i)).toHaveCount(0)
    await expect(page).toHaveURL(/\/invoices\/new/)
    await expectNoCodes(page)
  } finally {
    await closeDatabase(database)
  }
})

test('Escape steps back, and the empty state offers Relaties', async ({ page }) => {
  await administrationReady(page, 'Guided Leeg BV')

  await page.goto('/invoices/new')
  await expect(page.getByText('Nog geen klanten', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Naar Relaties' })).toBeVisible()

  await addCustomer(page)
  await page.goto('/invoices/new')
  await page.getByRole('option', { name: /Hotel Zeezicht/ }).click()
  await page.getByRole('button', { name: /Verder/ }).click()
  await expect(page.getByText('Stap 2 van 4')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Stap 1 van 4')).toBeVisible()
})

test('Geavanceerd on keeps the bookkeeper form', async ({ page }) => {
  await administrationReady(page, 'Guided Advanced BV')
  await addCustomer(page)

  await enableAdvancedMode(page)

  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await expect(page.getByLabel('Referentie klant')).toBeVisible()
  await expect(page.getByText('Stap 1 van 4')).toHaveCount(0)
})
