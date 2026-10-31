import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import {
  chooseInAccountMenu,
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  openEntitySwitcher,
  signIn,
  uniqueEmail,
} from './support'

/**
 * The dashboard as a work queue, in a browser.
 *
 * Everything here is a "the screen did not change" failure, which is what this
 * suite is for: focus that does not land, a row that does not open, a book
 * year that says one thing in the shell and another in the report. None of it
 * is visible to a handler test.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

const MONTHS_NL = [
  'januari',
  'februari',
  'maart',
  'april',
  'mei',
  'juni',
  'juli',
  'augustus',
  'september',
  'oktober',
  'november',
  'december',
] as const

async function anAdministration(
  page: Page,
  name: string,
  options?: { readonly startInCurrentMonth?: boolean },
): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  // Keyboard specs that assume a draft is the top to-do need no closed VAT
  // period waiting — start the book year in the current month for those.
  if (options?.startInCurrentMonth === true) {
    await chooseOption(page, 'Begint in', MONTHS_NL[new Date().getMonth()]!)
  }
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
}

/** A customer and a saved draft, which is the cheapest row in the queue. */
async function aDraftInvoice(page: Page): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Wachtende Klant N.V.')
  await page.getByLabel('E-mail').fill('inkoop@wachtendeklant.nl')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Wachtende Klant N.V.' })).toBeVisible()

  // Draft setup uses the bookkeeper form (Geavanceerd); Eigenaar default is guided (#45).
  await enableAdvancedMode(page)
  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Omschrijving regel 1').fill('Advieswerk')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Prijs regel 1').fill('100,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page.getByRole('heading', { name: /Factuur Concept/ })).toBeVisible()
}

test('an empty administration shows the redesigned dashboard and a way to start', async ({
  page,
}) => {
  await anAdministration(page, 'Leeg Bureau BV')

  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  // No email local-part in the greeting (designer #67).
  await expect(page.getByRole('heading', { name: /@|e2e-/ })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Kerncijfers' })).toBeVisible()
  // No operational work yet — drafts / bank / inbox stay off the list. A due
  // btw-aangifte may still appear (the period closed even with empty books).
  await expect(page.getByRole('link', { name: /concept(en)? om te versturen/i })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /bankregels wachten/ })).toHaveCount(0)
  // No invented "import your books" to-do (decision 2 / #107).
  await expect(page.getByText(/Haal je boekhouding over/i)).toHaveCount(0)
  // Empty queue → "Niets te doen" when nothing (incl. VAT) is waiting.
  const todoHeading = page.getByRole('heading', { name: 'Te doen' })
  const emptyHeading = page.getByRole('heading', { name: 'Niets te doen' })
  const hasTodo = await todoHeading.isVisible().catch(() => false)
  const hasEmpty = await emptyHeading.isVisible().catch(() => false)
  expect(hasTodo || hasEmpty).toBeTruthy()

  // Header "Nieuwe factuur" is secondary on Home (PM #107); only a top to-do
  // owns primary. With an empty queue the empty-state action is also outline.
  const newInvoice = page
    .locator('#main')
    .getByRole('link', { name: /Nieuwe factuur/ })
    .first()
  await expect(newInvoice).toHaveAttribute('data-variant', 'outline')
  await newInvoice.click()
  await expect(page).toHaveURL(/\/invoices\/new$/)
})

test('the queue lists what is waiting and opens the screen where it is done', async ({ page }) => {
  await anAdministration(page, 'Werklijst BV', { startInCurrentMonth: true })
  await aDraftInvoice(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Te doen' })).toBeVisible()
  await hydrated(page)
  const row = page.getByRole('link', { name: /concept(en)? om te versturen/i })
  await expect(row).toBeVisible()
  // #5 AC: the count is in the title (PM #67). Singular form for count 1.
  await expect(row).toContainText('1 concept om te versturen')
  await expect(row).toContainText('Openen')

  // Only the top to-do's action is primary (PM #107). Header invoice stays outline.
  await expect(
    page
      .locator('#main')
      .getByRole('link', { name: /Nieuwe factuur/ })
      .first(),
  ).toHaveAttribute('data-variant', 'outline')
  const todoList = page
    .locator('#main')
    .getByRole('list')
    .filter({
      has: page.getByRole('link', { name: /concept(en)? om te versturen/i }),
    })
  await expect(todoList.locator('[data-todo-action="primary"]')).toHaveCount(1)
  await expect(
    todoList.getByRole('listitem').first().locator('[data-todo-action="primary"]'),
  ).toHaveCount(1)

  // Do not steal focus on load — j/k start the cursor at row 0.
  // Arrow keys outside the list must not enter it (keep page scroll).
  await expect(row).not.toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(row).not.toBeFocused()
  await page.keyboard.press('j')
  await expect(row).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/invoices\?status=draft$/)

  // And the count was the truth: one draft on the dashboard, one draft here.
  // A queue whose numbers disagree with the screens behind them is a queue
  // people stop believing.
  await expect(page.getByRole('row')).toHaveCount(2)
})

test('Home drops the Kloppen de boeken health strip', async ({ page }) => {
  await anAdministration(page, 'Eenvoudig Dashboard BV')

  // Phase 1 Home: no jargon health / unmapped block (Design #112).
  await expect(page.getByRole('heading', { name: 'Kloppen de boeken?' })).toHaveCount(0)
  await expect(page.locator('#main').getByText('RGS-dekking')).toHaveCount(0)
  await expect(page.locator('#main').getByText('Proefbalans')).toHaveCount(0)
  await expect(page.getByText('Niet-gekoppelde rekeningen')).toHaveCount(0)
})

test('kerncijfers label overdue outstanding honestly, not as all receivables', async ({ page }) => {
  await anAdministration(page, 'Eerlijke Cijfers BV')

  const figures = page.getByRole('region', { name: 'Kerncijfers' })
  // Overdue-only figure until a full open-AR aggregate exists (#61 follow-up).
  await expect(figures.getByText('Te laat bij klanten')).toBeVisible()
  await expect(figures.getByText('Nog te ontvangen')).toHaveCount(0)
  await expect(figures.getByText('Verlopen facturen')).toHaveCount(0)
  // Bank suggestions and Exact finding counts stay out — no invented 0.
  await expect(page.getByText(/suggestie/i)).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Exact.*0|0.*Exact/i })).toHaveCount(0)

  // No-data tiles drop the value line (no em dash, no € 0,00 on bank).
  const bank = figures.getByRole('link', { name: /Op de bank/ })
  await expect(bank).toContainText('Nog geen bankrekening')
  await expect(bank).not.toContainText('—')
  await expect(bank).not.toContainText('Niet beschikbaar')
  // Successful payables zero still shows the amount + empty meta (not Unavailable).
  const payables = figures.getByRole('link', { name: /Nog te betalen/ })
  await expect(payables).toContainText('€')
  await expect(payables).toContainText('Niets open')
  await expect(payables).not.toContainText('Niet beschikbaar')
  // Successful P&L zero is an amount, not Unavailable.
  const profit = figures.getByRole('link', { name: /Winst|Verlies/ })
  await expect(profit).toContainText('€')
  await expect(profit).not.toContainText('Niet beschikbaar')
})

test('Bonnetje has no shortcut chip, and phone keeps one secondary under Te doen', async ({
  page,
}) => {
  await anAdministration(page, 'Bonnetje Shortcut BV')
  await hydrated(page)

  const desktopReceipt = page
    .locator('#main header')
    .getByRole('link', { name: /Bonnetje toevoegen/ })
  await expect(desktopReceipt).toBeVisible()
  // No chord on the action button (PM + Design #112); keymap unchanged.
  await expect(desktopReceipt.locator('kbd')).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.locator('#main header').getByRole('link', { name: /Bonnetje toevoegen/ }),
  ).toHaveCount(0)
  const phoneReceipt = page.locator('#main').getByRole('link', { name: /Bonnetje toevoegen/ })
  await expect(phoneReceipt).toBeVisible()
  await phoneReceipt.click()
  await expect(page).toHaveURL(/\/inbox$/)
})

test('Escape gives the keyboard back to the rest of the application', async ({ page }) => {
  await anAdministration(page, 'Ontsnapping BV', { startInCurrentMonth: true })
  await aDraftInvoice(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Te doen' })).toBeVisible()
  await hydrated(page)
  const row = page.getByRole('link', { name: /concept(en)? om te versturen/i })
  // Wait for the queue row before j: hydrated only proves the shell, and the
  // WorkQueue keydown listener attaches after items arrive. Pressing earlier
  // loses the keystroke and flakes on focus.
  await expect(row).toBeVisible()
  await expect(row).not.toBeFocused()
  await page.keyboard.press('j')
  await expect(row).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(row).not.toBeFocused()

  // And the global prefixes still work, which is the point of letting go.
  await page.keyboard.press('g')
  await page.keyboard.press('j')
  await expect(page.getByRole('heading', { name: 'Journaalposten' })).toBeVisible()
})

test('the book year in the shell is the administration’s, and the reports agree', async ({
  page,
}) => {
  await anAdministration(page, 'Boekjaar BV')

  // The combined switcher shows the year on its closed row; the labelled
  // select is one click in.
  await openEntitySwitcher(page)
  await expect(page.getByRole('combobox', { name: 'Boekjaar', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')

  // The shell switcher names the year; the redesigned dashboard greeting no
  // longer repeats "Boekjaar YYYY:" in the page header. Designer: closed row is
  // "Boekjaar 2026" only — no truncated date range.
  const switcher = page.getByRole('button', {
    name: /Administratie en boekjaar|Administration and book year/,
  })
  const switcherText = (await switcher.textContent()) ?? ''
  const year = /Boekjaar (\d{4})/.exec(switcherText)?.[1] ?? ''
  expect(year).toMatch(/^\d{4}$/)
  await expect(switcher).toContainText(`Boekjaar ${year}`)
  await expect(switcher).not.toContainText(/\d{2}-\d{2}-\d{4}/)

  await page.goto('/reports/trial-balance')
  await expect(page.locator('#main').getByText(new RegExp(`Boekjaar ${year}`))).toBeVisible()
})

test('a report can be pointed at another book year, and the link carries it', async ({ page }) => {
  await anAdministration(page, 'Twee Boekjaren BV')

  // Opening the next year has an API and no screen yet (that is issue #6), so
  // the second year is made the way the CLI would make it. The picker offers
  // whatever the administration has, which is the point of reading it from
  // `GET /fiscal-years` rather than from the clock.
  const next = String(new Date().getUTCFullYear() + 1)
  const created = await page.request.post('/api/v1/fiscal-years', {
    headers: { 'Idempotency-Key': crypto.randomUUID(), 'Content-Type': 'application/json' },
    data: { code: next },
  })
  expect(created.ok(), await created.text()).toBeTruthy()

  await page.goto('/reports/trial-balance')
  const thisYear = String(new Date().getUTCFullYear())
  const main = page.locator('#main')
  await expect(main.getByText(new RegExp(`Boekjaar ${thisYear}`))).toBeVisible()

  await chooseOption(page, 'Boekjaar', new RegExp(`^${next}`))
  await expect(main.getByText(new RegExp(`Boekjaar ${next}`))).toBeVisible()

  // In the address, so the report is a thing somebody can send.
  await expect(page).toHaveURL(new RegExp(`fiscalYear=${next}`))
  await page.reload()
  await expect(main.getByText(new RegExp(`Boekjaar ${next}`))).toBeVisible()

  // And walking to another report keeps the year, though the link carries no
  // parameter: that is the cookie doing the remembering.
  // Reports tab accessible name includes the digit hint (`Balans` + `2`).
  await page
    .getByRole('navigation', { name: 'Rapporten' })
    .getByRole('link', { name: /Balans/ })
    .click()
  await expect(page.getByRole('heading', { name: 'Balans' })).toBeVisible()
  await expect(page.getByText(`${next}-12-31`)).toBeVisible()
})

test('a boekjaar that is not the calendar year is the one the screens use', async ({ page }) => {
  // The bug this replaces, as directly as a browser can state it: an
  // administration whose only book year is an earlier one, running July to
  // June. The calendar year is not that year and has no book year at all, so
  // the old `new Date().getFullYear()` asked for a year that does not exist.
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()

  await page.getByLabel('Naam van de administratie').fill('Gebroken Boekjaar BV')
  const opened = String(new Date().getUTCFullYear() - 1)
  await page.getByLabel('Boekjaar').fill(opened)
  await chooseOption(page, 'Begint in', 'juli')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()

  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  const switcher = page.getByRole('button', {
    name: /Administratie en boekjaar|Administration and book year/,
  })
  await expect(switcher).toContainText(`Boekjaar ${opened}`)
  // Closed summary is year-only (#107 Designer); the July–June span still
  // drives reports (ageing as-of below).
  await expect(switcher).not.toContainText(`01-07-${opened}`)

  await page.goto('/reports/trial-balance')
  await expect(page.locator('#main').getByText(new RegExp(`Boekjaar ${opened}`))).toBeVisible()

  // And a report about open items ages as of the end of that year rather than
  // as of today, which would call everything in it a year late.
  await page.goto('/reports/debtor-ageing')
  await expect(
    page.getByText(new RegExp(`Vervallen verkoopfacturen per 30-06-${String(Number(opened) + 1)}`)),
  ).toBeVisible()
})

test('the theme is light to start with, and dark stays dark', async ({ page }) => {
  await anAdministration(page, 'Weergave BV')

  // Light is the default, and it is the absence of a class rather than a
  // second set of tokens.
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  await chooseInAccountMenu(page, 'Weergave', 'Donker')
  await expect(page.locator('html')).toHaveClass(/dark/)

  // Through a reload, because a theme resolved only in the browser is a white
  // flash on every page load.
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)

  await chooseInAccountMenu(page, 'Weergave', 'Licht')
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  // Systeem is a preference the cookie can hold; the appearance then follows
  // the OS. Chromium in these specs is light, so the class comes off.
  await chooseInAccountMenu(page, 'Weergave', 'Systeem')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

test('ageing is in the navigation, on both sides', async ({ page }) => {
  await anAdministration(page, 'Ouderdom BV')

  // Ageing is Reports SubNav + palette (#107), not a top-level rail item.
  await page.goto('/reports/profit-and-loss')
  const reports = page.getByRole('navigation', { name: 'Rapporten' })
  await reports.getByRole('link', { name: /Openstaand bij klanten/ }).click()
  await expect(page.getByRole('heading', { name: 'Ouderdomsanalyse debiteuren' })).toBeVisible()

  await reports.getByRole('link', { name: /Crediteuren/ }).click()
  await expect(page.getByRole('heading', { name: 'Ouderdomsanalyse crediteuren' })).toBeVisible()
})
