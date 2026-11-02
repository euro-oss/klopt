import { expect, test, type ConsoleMessage, type Page, type Request } from '@playwright/test'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

/**
 * #173 — confirm before a bulk reminder send on /dunning.
 *
 * Covers: dialog from the same send set, Esc / plain Enter send nothing,
 * ⌘/Ctrl+Enter and Confirm send exactly N, a single-row send skips the dialog,
 * and a due-today invoice is absent from list / count / send.
 */

type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>
}

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

/**
 * True when this POST is a reminder send.
 *
 * The UI calls the TanStack `sendReminder` server fn. Its URL encodes
 * `export":"sendRe…` as base64 (`c2VuZFJl…`); the body carries `expectedStage`.
 * Also match the REST `/sales-invoices/{id}/reminders` route.
 */
function isReminderSendRequest(request: Request): boolean {
  if (request.method() !== 'POST') return false
  const url = request.url()
  if (url.includes('/sales-invoices/') && url.includes('/reminders')) return true
  // base64("sendRe") — prefix of export":"sendReminder in the server-fn id.
  if (url.includes('/_serverFn/') && url.includes('c2VuZFJl')) return true
  const body = request.postData() ?? ''
  return body.includes('"expectedStage"') || body.includes('expectedStage')
}

async function openAdmin(page: Page): Promise<string> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Herinnering Bevestigen BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)

  const entityRes = await page.request.get('/api/v1/entity')
  expect(entityRes.ok()).toBeTruthy()
  const entity = (await entityRes.json()) as { id: string }
  return entity.id
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function seedContact(page: Page, number: string, name: string, email: string): Promise<void> {
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill(number)
  await page.getByLabel('Naam', { exact: true }).fill(name)
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('87654321')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Straat').fill('Voorbeeldstraat')
  await page.getByLabel('Huisnr.').fill('1')
  await page.getByLabel('Postcode').fill('1000 AA')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  // Contacts list rows are buttons after the #130 redesign (not table cells).
  await expect(page.getByRole('button', { name: new RegExp(escapeRegExp(name)) })).toBeVisible()
}

async function draftAndIssue(
  page: Page,
  customer: string,
  description: string,
  price: string,
  issueDate: string,
): Promise<string> {
  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByRole('combobox', { name: 'Klant' }).click()
  await page.getByRole('option', { name: new RegExp(customer) }).click()
  await page.getByLabel('Factuurdatum').fill(issueDate)
  await page.getByLabel('Referentie klant').fill(`PO-${description.slice(0, 8)}`)
  await page.getByLabel('Omschrijving regel 1').fill(description)
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Eenheid regel 1').fill('EA')
  await page.getByLabel('Prijs regel 1').fill(price)
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page.getByRole('heading', { name: /Factuur Concept/ })).toBeVisible()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('heading', { name: /Factuur \d{4}-/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'boeking', exact: true })).toBeVisible()
  return new URL(page.url()).pathname.split('/').pop() ?? ''
}

/** Local calendar date (YYYY-MM-DD), matching the app's asOf — not UTC. */
function localIsoDate(d: Date): string {
  const year = String(d.getFullYear())
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function daysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return localIsoDate(d)
}

function todayIso(): string {
  return localIsoDate(new Date())
}

async function reminderDeliveryCount(entityId: string): Promise<number> {
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const sql = (database as unknown as { $client: SqlTag }).$client
  try {
    const rows = (await sql`
      select count(*)::int as n
      from klopt.invoice_deliveries
      where entity_id = ${entityId}::uuid
        and purpose = 'reminder'
    `) as readonly { n: number }[]
    return rows[0]?.n ?? 0
  } finally {
    await closeDatabase(database)
  }
}

async function reminderDeliveryInvoiceIds(entityId: string): Promise<readonly string[]> {
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const sql = (database as unknown as { $client: SqlTag }).$client
  try {
    const rows = (await sql`
      select invoice_id::text as id
      from klopt.invoice_deliveries
      where entity_id = ${entityId}::uuid
        and purpose = 'reminder'
      order by invoice_id
    `) as readonly { id: string }[]
    return rows.map((row) => row.id)
  } finally {
    await closeDatabase(database)
  }
}

async function assertDialogFitsViewport(page: Page): Promise<void> {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  const overflow = await dialog.evaluate((node) => ({
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
  }))
  expect(
    overflow.scrollWidth,
    `dialog overflows horizontally (${String(overflow.scrollWidth)} > ${String(overflow.clientWidth)})`,
  ).toBeLessThanOrEqual(overflow.clientWidth)

  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  const width = viewport!.width
  const height = viewport!.height
  for (const name of [/Annuleren|Cancel/, /Verstuur \d+|Send \d+/] as const) {
    const box = await dialog.getByRole('button', { name }).boundingBox()
    expect(box, `missing button ${String(name)}`).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5)
    expect(box!.y + box!.height).toBeLessThanOrEqual(height + 0.5)
  }
}

async function listedDialogInvoiceIds(page: Page): Promise<string[]> {
  return page
    .getByRole('alertdialog')
    .locator('[data-invoice-id]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('data-invoice-id'))
        .filter((id): id is string => id !== null),
    )
}

async function setDueDate(invoiceId: string, entityId: string, dueDate: string): Promise<void> {
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const sql = (database as unknown as { $client: SqlTag }).$client
  try {
    await sql`
      update klopt.sales_invoices
      set due_date = ${dueDate}::date, updated_at = now()
      where id = ${invoiceId}::uuid
        and entity_id = ${entityId}::uuid
    `
  } finally {
    await closeDatabase(database)
  }
}

test('bulk reminder confirm: dialog matches send set; Esc and Enter send nothing; confirm sends N', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  const entityId = await openAdmin(page)

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

  await page.goto('/contacts')
  await seedContact(page, 'DEB-EVA', 'Eva Jansen', 'eva@example.nl')
  await seedContact(page, 'DEB-RUBEN', 'Ruben de Vries', 'ruben@example.nl')

  // Overdue far enough for stage 1+ (30-day terms; issue ~80 days ago → ~50 overdue).
  // Excl. 21% btw: 500,00 → 605,00 and 525,21 → 635,50; dialog total 1.240,50.
  const evaId = await draftAndIssue(page, 'Eva Jansen', 'Advies Eva', '500,00', daysAgo(80))
  const rubenId = await draftAndIssue(page, 'Ruben de Vries', 'Advies Ruben', '525,21', daysAgo(90))
  // Due today must stay out of list, count and send (#173 Legal).
  const dueTodayId = await draftAndIssue(
    page,
    'Eva Jansen',
    'Vandaag vervallen',
    '99,00',
    daysAgo(30),
  )
  await setDueDate(dueTodayId, entityId, todayIso())

  const reminderPosts: string[] = []
  page.on('request', (request) => {
    if (isReminderSendRequest(request)) reminderPosts.push(request.url())
  })

  await page.goto('/dunning')
  await hydrated(page)

  await expect(page.getByRole('button', { name: /Eva Jansen/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Ruben de Vries/ })).toBeVisible()
  // Due-today invoice is not listed.
  await expect(page.getByText('Vandaag vervallen')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /99,00/ })).toHaveCount(0)

  const sendButton = page.getByRole('button', {
    name: /Alle 2 herinneringen versturen|Send all 2 reminders/,
  })
  await expect(sendButton).toBeVisible()

  // Nothing selected → default is all due; open the dialog.
  await sendButton.click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: /2 herinneringen versturen\?/ })).toBeVisible()
  await expect(dialog.getByText('Eva Jansen')).toBeVisible()
  await expect(dialog.getByText('Ruben de Vries')).toBeVisible()
  // Rows carry invoice number, amount (tabular mono) and days overdue.
  await expect(dialog.getByText(/\d{4}-\d{4}/).first()).toBeVisible()
  await expect(dialog.getByText(/dagen te laat/).first()).toBeVisible()
  await expect(dialog.getByText(/Totaal €\s*1\.240,50/)).toBeVisible()
  await expect(dialog.getByText(/Ze gaan direct per e-mail/)).toBeVisible()
  // Focus starts on Annuleren.
  await expect(dialog.getByRole('button', { name: 'Annuleren' })).toBeFocused()
  // Primary is "Verstuur N" with a mod+Enter chip — not a plain "Versturen".
  await expect(dialog.getByRole('button', { name: /Verstuur 2/ })).toBeVisible()

  const listedIds = await listedDialogInvoiceIds(page)
  expect(listedIds.sort()).toEqual([evaId, rubenId].sort())

  // Plain Enter on focused Annuleren cancels; focus returns to the opener.
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(sendButton).toBeFocused()
  expect(reminderPosts).toEqual([])
  expect(await reminderDeliveryCount(entityId)).toBe(0)
  await expect(page.getByText(/verstuurd naar/)).toHaveCount(0)

  // Re-open: plain Enter on the primary must not send.
  await sendButton.click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Verstuur 2/ })
    .focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alertdialog')).toBeVisible()
  expect(reminderPosts).toEqual([])
  expect(await reminderDeliveryCount(entityId)).toBe(0)

  // Esc cancels — nothing sent; focus returns to the opener.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(sendButton).toBeFocused()
  expect(reminderPosts).toEqual([])
  expect(await reminderDeliveryCount(entityId)).toBe(0)
  await expect(page.getByText(/verstuurd naar/)).toHaveCount(0)

  // Re-open and confirm with ⌘/Ctrl+Enter (issue AC), not a plain click.
  await sendButton.click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expect(
    page.getByRole('alertdialog').getByRole('button', { name: 'Annuleren' }),
  ).toBeFocused()
  const listedBeforeSend = await listedDialogInvoiceIds(page)
  expect(listedBeforeSend.sort()).toEqual(listedIds.sort())
  await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByText(/verstuurd naar/)).toBeVisible()
  // Both POSTs finish before the delivery rows are visible — poll, don't race.
  await expect.poll(async () => reminderDeliveryCount(entityId)).toBe(2)
  expect(reminderPosts.length).toBeGreaterThanOrEqual(2)
  const sentIds = await reminderDeliveryInvoiceIds(entityId)
  expect([...sentIds].sort()).toEqual([...listedIds].sort())
  await expect(page.getByRole('button', { name: /Eva Jansen/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Ruben de Vries/ })).toHaveCount(0)
  // Empty queue: header send is unmounted — never "Alle 0 herinneringen versturen".
  await expect(
    page.getByRole('button', { name: /Alle \d+ herinneringen versturen|Send all \d+ reminders/ }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Alle 0 herinneringen versturen/ })).toHaveCount(0)

  // Still no due-today row after the send, and it was never chased.
  await expect(page.getByText('Vandaag vervallen')).toHaveCount(0)
  const dueTodayDeliveries = await page.request.get(
    `/api/v1/sales-invoices/${dueTodayId}/deliveries`,
  )
  expect(dueTodayDeliveries.ok()).toBeTruthy()
  const dueTodayBody = (await dueTodayDeliveries.json()) as {
    deliveries: readonly { purpose: string }[]
  }
  expect(dueTodayBody.deliveries.filter((row) => row.purpose === 'reminder')).toHaveLength(0)

  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([])
})

test('bulk confirm dialog fits the 390 viewport in light and dark', async ({ page }) => {
  test.setTimeout(120_000)
  await openAdmin(page)

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

  await page.goto('/contacts')
  // Long names must wrap on phone (not truncate); days-overdue stays visible.
  await seedContact(
    page,
    'DEB-LONG-A',
    'Eva Jansen van den Zeer Lange Achternaam B.V.',
    'eva-long@example.nl',
  )
  await seedContact(
    page,
    'DEB-LONG-B',
    'Ruben de Vries Internationale Handelscompagnie',
    'ruben-long@example.nl',
  )
  await draftAndIssue(
    page,
    'Eva Jansen van den Zeer Lange Achternaam B.V.',
    'Lang A',
    '500,00',
    daysAgo(80),
  )
  await draftAndIssue(
    page,
    'Ruben de Vries Internationale Handelscompagnie',
    'Lang B',
    '525,21',
    daysAgo(80),
  )

  await page.setViewportSize({ width: 390, height: 844 })
  for (const theme of ['light', 'dark'] as const) {
    await page.goto('/dunning')
    await expect(page.getByRole('heading', { name: /Verkoop/ })).toBeVisible()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate((value) => {
      document.documentElement.classList.toggle('dark', value === 'dark')
      document.documentElement.dataset['theme'] = value
    }, theme)
    await page.getByRole('button', { name: /Alle 2 herinneringen versturen/ }).click()
    await assertDialogFitsViewport(page)
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByText('Eva Jansen van den Zeer Lange Achternaam B.V.')).toBeVisible()
    await expect(dialog.getByText('Ruben de Vries Internationale Handelscompagnie')).toBeVisible()
    await expect(dialog.getByText(/dagen te laat/).first()).toBeVisible()
    // Phone hides the ⌘/Ctrl chip (DERIVED: no keyboard hints on phone).
    await expect(
      dialog
        .getByRole('button', { name: /Verstuur 2/ })
        .locator('kbd')
        .first(),
    ).toBeHidden()
    await page.keyboard.press('Escape')
  }
})

test('plain Enter on an open bulk confirm does not send; Cmd/Ctrl+Enter does', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'modifier chord coverage is chromium-only here')

  const entityId = await openAdmin(page)

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

  await page.goto('/contacts')
  await seedContact(page, 'DEB-A', 'Eva Jansen', 'eva2@example.nl')
  await seedContact(page, 'DEB-B', 'Ruben de Vries', 'ruben2@example.nl')
  await draftAndIssue(page, 'Eva Jansen', 'Chord Eva', '100,00', daysAgo(80))
  await draftAndIssue(page, 'Ruben de Vries', 'Chord Ruben', '200,00', daysAgo(80))

  const reminderPosts: string[] = []
  page.on('request', (request) => {
    if (isReminderSendRequest(request)) reminderPosts.push(request.url())
  })

  await page.goto('/dunning')
  await hydrated(page)
  const sendButton = page.getByRole('button', { name: /Alle 2 herinneringen versturen/ })
  await expect(sendButton).toBeVisible()

  // Ctrl+Enter with focus on <body> (not the send button) must still restore
  // focus to the header send control after Esc — never leave focus on BODY.
  await page.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  })
  await expect
    .poll(async () => page.evaluate(() => document.activeElement?.tagName ?? 'NONE'))
    .toBe('BODY')
  await page.keyboard.press('Control+Enter')
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Annuleren' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(sendButton).toBeFocused()
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
  expect(reminderPosts).toEqual([])
  expect(await reminderDeliveryCount(entityId)).toBe(0)

  // Re-open via the button; Enter on Cancel cancels; focus returns to opener.
  await sendButton.click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expect(
    page.getByRole('alertdialog').getByRole('button', { name: 'Annuleren' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(sendButton).toBeFocused()
  expect(reminderPosts).toEqual([])
  expect(await reminderDeliveryCount(entityId)).toBe(0)

  // Re-open; Non-Apple CI: Ctrl+Enter confirms. Wait for both sends to finish.
  await sendButton.click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByText(/verstuurd naar/)).toBeVisible()
  await expect.poll(async () => reminderDeliveryCount(entityId)).toBe(2)
  expect(reminderPosts.length).toBeGreaterThanOrEqual(2)
  await expect(page.getByRole('button', { name: /Eva Jansen/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Ruben de Vries/ })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: /Alle \d+ herinneringen versturen|Send all \d+ reminders/ }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Alle 0 herinneringen versturen/ })).toHaveCount(0)
})

test('header send is dimmed when nothing to send or busy', async ({ page }) => {
  test.setTimeout(120_000)
  const entityId = await openAdmin(page)

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

  await page.goto('/contacts')
  // No email → listed but not sendable (sendableCount 0 while actions remain).
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-NOMAIL')
  await page.getByLabel('Naam', { exact: true }).fill('Zonder Mail')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('87654321')
  await page.getByLabel('Straat').fill('Voorbeeldstraat')
  await page.getByLabel('Huisnr.').fill('1')
  await page.getByLabel('Postcode').fill('1000 AA')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Zonder Mail/ })).toBeVisible()
  await seedContact(page, 'DEB-DIM-B', 'Ruben de Vries', 'ruben-dim@example.nl')
  await draftAndIssue(page, 'Zonder Mail', 'Dim geen mail', '100,00', daysAgo(80))

  await page.goto('/dunning')
  await hydrated(page)
  const dimmed = page.getByRole('button', { name: /Alle 0 herinneringen versturen/ })
  await expect(dimmed).toBeVisible()
  await expect(dimmed).toHaveAttribute('aria-disabled', 'true')
  await expect(dimmed).not.toHaveAttribute('disabled')
  await expect(dimmed).toHaveClass(/aria-disabled:opacity-50/)
  await expect(dimmed).toHaveClass(/aria-disabled:cursor-not-allowed/)
  await expect(dimmed).toHaveCSS('opacity', '0.5')
  await expect(dimmed).toHaveCSS('cursor', 'not-allowed')
  await dimmed.focus()
  await expect(dimmed).toBeFocused()

  // Add a sendable overdue row and assert the busy dim while the send is held.
  await draftAndIssue(page, 'Ruben de Vries', 'Dim Ruben', '200,00', daysAgo(80))
  await page.goto('/dunning')
  await hydrated(page)
  const readySend = page.getByRole('button', { name: /Herinnering versturen/ })
  await expect(readySend).not.toHaveAttribute('aria-disabled', 'true')
  await expect(readySend).toHaveCSS('opacity', '1')

  let releaseReminders: (() => void) | undefined
  const holdReminders = new Promise<void>((resolve) => {
    releaseReminders = resolve
  })
  await page.route('**/*', async (route) => {
    const request = route.request()
    if (isReminderSendRequest(request)) {
      await holdReminders
    }
    await route.continue()
  })

  // N=1 skips confirm — click sends immediately into busy.
  await readySend.click()
  const busySend = page.getByRole('button', { name: /Bezig/ })
  await expect(busySend).toBeVisible()
  await expect(busySend).toHaveAttribute('aria-disabled', 'true')
  await expect(busySend).not.toHaveAttribute('disabled')
  await expect(busySend).toHaveCSS('opacity', '0.5')
  await expect(busySend).toHaveCSS('cursor', 'not-allowed')
  releaseReminders?.()
  await expect(page.getByText(/verstuurd naar/)).toBeVisible()
  await expect.poll(async () => reminderDeliveryCount(entityId)).toBe(1)
})

test('empty reminders page never shows Alle 0 herinneringen versturen', async ({ page }) => {
  await openAdmin(page)
  await page.goto('/dunning')
  await hydrated(page)
  await expect(page.getByText(/Geen herinneringen nodig/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Alle \d+ herinneringen versturen|Send all \d+ reminders/ }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Alle 0 herinneringen versturen/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Herinnering versturen/ })).toHaveCount(0)
})

test('after confirming a partial bulk send, focus returns to the header send', async ({ page }) => {
  test.setTimeout(120_000)
  await openAdmin(page)

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

  await page.goto('/contacts')
  await seedContact(page, 'DEB-FOC-A', 'Eva Jansen', 'eva-foc@example.nl')
  await seedContact(page, 'DEB-FOC-B', 'Ruben de Vries', 'ruben-foc@example.nl')
  await seedContact(page, 'DEB-FOC-C', 'Atelier Noordkust', 'atelier-foc@example.nl')
  await draftAndIssue(page, 'Eva Jansen', 'Focus Eva', '100,00', daysAgo(80))
  await draftAndIssue(page, 'Ruben de Vries', 'Focus Ruben', '200,00', daysAgo(80))
  await draftAndIssue(page, 'Atelier Noordkust', 'Focus Atelier', '150,00', daysAgo(80))

  await page.goto('/dunning')
  await hydrated(page)
  // Deselect one so confirm sends N=2; one row remains so the header stays mounted.
  await page
    .getByRole('button', { name: /Atelier Noordkust/ })
    .locator('[role="checkbox"]')
    .click()
  const sendButton = page.getByRole('button', { name: /Alle 2 herinneringen versturen/ })
  await expect(sendButton).toBeVisible()
  await sendButton.click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByText(/verstuurd naar/)).toBeVisible()
  // sendAll_one = "Herinnering versturen" (+ optional ⌘/Ctrl chip text).
  const after = page.getByRole('button', { name: /Herinnering versturen/ })
  await expect(after).toBeVisible()
  await expect(after).toBeFocused()
  await expect(after).not.toHaveAttribute('aria-disabled', 'true')
})

test('a single reminder send skips the confirm dialog', async ({ page }) => {
  await openAdmin(page)

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

  await page.goto('/contacts')
  await seedContact(page, 'DEB-ONE', 'Eva Jansen', 'eva-one@example.nl')
  await draftAndIssue(page, 'Eva Jansen', 'Enkele herinnering', '121,00', daysAgo(80))

  await page.goto('/dunning')
  await hydrated(page)
  await expect(page.getByRole('button', { name: /Herinnering versturen/ })).toBeVisible()
  await page.getByRole('button', { name: /Herinnering versturen/ }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByText(/verstuurd naar Eva Jansen/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Eva Jansen/ })).toHaveCount(0)
})
