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

async function anAdministration(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
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

  // Header CTA is the next step when the empty-state button is not shown.
  await page
    .getByRole('link', { name: /Nieuwe factuur/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/invoices\/new$/)
})

test('the queue lists what is waiting and opens the screen where it is done', async ({ page }) => {
  await anAdministration(page, 'Werklijst BV')
  await aDraftInvoice(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Wat aandacht vraagt' })).toBeVisible()
  await hydrated(page)
  const row = page.getByRole('link', { name: /concept(en)? om te versturen/i })
  await expect(row).toBeVisible()
  // #5 AC: the count is in the title (PM #67). Singular form for count 1.
  await expect(row).toContainText('1 concept om te versturen')
  await expect(row).toContainText('Openen')

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

test('Geavanceerd off hides the whole health strip on the dashboard', async ({ page }) => {
  await anAdministration(page, 'Eenvoudig Dashboard BV')

  // Owner defaults to Geavanceerd off (#65 / designer #67): jargon health
  // (Kloppen de boeken?, RGS, Proefbalans) stays out until advanced is on.
  await expect(page.getByRole('heading', { name: 'Kloppen de boeken?' })).toHaveCount(0)
  await expect(page.locator('#main').getByText('RGS-dekking')).toHaveCount(0)
  await expect(page.locator('#main').getByText('Proefbalans')).toHaveCount(0)
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
})

test('Escape gives the keyboard back to the rest of the application', async ({ page }) => {
  await anAdministration(page, 'Ontsnapping BV')
  await aDraftInvoice(page)

  await page.goto('/')
  await hydrated(page)
  const row = page.getByRole('link', { name: /concept(en)? om te versturen/i })
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
  // longer repeats "Boekjaar YYYY:" in the page header.
  const switcher =
    (await page
      .getByRole('button', { name: /Administratie en boekjaar|Administration and book year/ })
      .textContent()) ?? ''
  const year = /Boekjaar (\d{4})/.exec(switcher)?.[1] ?? ''
  expect(year).toMatch(/^\d{4}$/)

  // The dates sit on the switcher row, because a boekjaar labelled 2025 may
  // run into 2026 and a label alone is the guess this replaced.
  await expect(page.getByText(/\d{2}-\d{2}-\d{4} – \d{2}-\d{2}-\d{4}/)).toBeVisible()

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
  await page.getByRole('link', { name: 'Balans', exact: true }).click()
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
  await expect(
    page.getByRole('button', { name: /Administratie en boekjaar|Administration and book year/ }),
  ).toContainText(`Boekjaar ${opened}`)
  await expect(
    page.getByText(`01-07-${opened} – 30-06-${String(Number(opened) + 1)}`),
  ).toBeVisible()

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

  // Simple-mode label under Rapporten (#61 slice 2); Geavanceerd renames it Debiteuren.
  await page.getByRole('link', { name: 'Openstaand bij klanten' }).click()
  await expect(page.getByRole('heading', { name: 'Ouderdomsanalyse debiteuren' })).toBeVisible()

  await page.getByRole('link', { name: 'Crediteuren' }).click()
  await expect(page.getByRole('heading', { name: 'Ouderdomsanalyse crediteuren' })).toBeVisible()
})
