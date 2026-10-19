import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import { findEntityIdByName, setPeriodStatus } from '@klopt/db/testing'
import {
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  OUTBOX,
  signIn,
  uniqueEmail,
} from './support'

/**
 * The koppelwachtrij, in a browser (#61 slice 6 redesign).
 *
 * The keyboard is the feature — j/k move, Enter opens then books, u clears,
 * Esc leaves — so the assertions are about what a keystroke does. Period locks
 * (a–d) cover named copy, role gates, and the Esc path that used to assert
 * nothing about a lock.
 */

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'core',
  'test',
  'bank',
  '__fixtures__',
)

/** March in a Jan–Dec year — the MT940 fixture books on 2026-03-02 … 03-05. */
const MARCH = 3

function uniqueAdminName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`
}

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  rmSync(OUTBOX, { recursive: true, force: true })
})

/** A fresh administration with a bank account and a statement read in. */
async function withStatement(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByLabel('Naam', { exact: true }).fill('Rekening-courant')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL02ABNA0123456789')).toBeVisible()

  await expect(page.locator('input[type="file"]')).toBeEnabled()

  await page.setInputFiles('input[type="file"]', join(FIXTURES, 'statement.mt940'))
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await page.getByRole('button', { name: 'Inlezen', exact: true }).click()
  await expect(page.getByText('4 transacties ingelezen.')).toBeVisible()
}

function queueRows(page: Page) {
  return page.locator('[data-slot="scroll-table"] tbody tr')
}

async function setMarchStatus(
  entityName: string,
  status: 'open' | 'soft_closed' | 'hard_closed',
): Promise<void> {
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  try {
    const entityId = await findEntityIdByName(database, entityName)
    if (entityId === null) throw new Error(`No entity named ${entityName}`)
    await setPeriodStatus(database, entityId, MARCH, status)
  } finally {
    await closeDatabase(database)
  }
}

test('a bookkeeper works through the queue with the keyboard', async ({ page }) => {
  await withStatement(page, 'Koppelen BV')

  await page.getByRole('link', { name: '4 koppelen' }).click()
  await expect(page.getByRole('heading', { name: 'Koppelen' })).toBeVisible()

  const rows = queueRows(page)
  await expect(rows).toHaveCount(4)

  // No invoices exist, so nothing is suggested and a choice has to be made.
  await expect(page.getByText('Geen voorstel. Kies zelf een categorie.')).toBeVisible()

  // The selected line is the first, and the detail pane follows the selection.
  await expect(page.getByRole('heading', { name: /Kosten betalingsverkeer/ })).toBeVisible()

  await hydrated(page)

  // No focus moved on load — document body (or nothing in the queue) keeps focus.
  await expect(rows.first()).not.toBeFocused()

  // Down and up move the selection, and the detail pane keeps up.
  await page.keyboard.press('ArrowDown')
  await expect(
    page.getByRole('heading', { name: /Overboeking spaarrekening|spaarrekening/ }),
  ).toBeVisible()
  await page.keyboard.press('ArrowUp')

  // Book the selected line by hand (simple mode: names, not account numbers).
  await chooseOption(page, 'Categorie', /Algemene kosten/)
  await page.getByRole('button', { name: 'Boeken' }).last().click()

  await expect(page.getByText(/Gekoppeld:|Geboekt als boeking/)).toBeVisible()
  await expect(rows).toHaveCount(3)

  await page.getByRole('button', { name: 'Overslaan' }).click()
  await expect(page.getByText('Overgeslagen.')).toBeVisible()
  await expect(rows).toHaveCount(2)
})

test('a payment is booked by confirming the candidate, not by trusting the top one', async ({
  page,
}) => {
  await withStatement(page, 'Koppelen Factuur BV')

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Grote Klant N.V.')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Grote Klant N.V.' })).toBeVisible()

  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Referentie klant').fill('KP-1')
  await page.getByLabel('Omschrijving regel 1').fill('Advieswerk')
  await page.getByLabel('Prijs regel 1').fill('1000,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('link', { name: 'journaalpost', exact: true })).toBeVisible()

  await page.goto('/bank/match')
  await expect(page.getByRole('heading', { name: 'Koppelen' })).toBeVisible()

  await hydrated(page)

  // The queue is newest first, so walk down to the payment.
  const suggestion = page.getByText(/staat in de omschrijving en het bedrag klopt precies/)
  for (let step = 0; step < 4 && !(await suggestion.isVisible()); step += 1) {
    await page.keyboard.press('ArrowDown')
    await suggestion.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined)
  }

  await expect(suggestion).toBeVisible()
  await expect(page.getByText('Zeker').first()).toBeVisible()

  // Two keystrokes: Enter opens the panel onto the candidate; Enter books it.
  await page.keyboard.press('Enter')
  await expect(page.locator('[role="option"][aria-selected="true"]')).toBeFocused()
  await expect(page.getByText(/Gekoppeld:|Geboekt als boeking/)).toHaveCount(0)

  await page.keyboard.press('Enter')
  await expect(page.getByText(/Gekoppeld:|Geboekt als boeking/)).toBeVisible()
})

test('the keys the match screen prints are the keys it answers to', async ({ page }) => {
  await withStatement(page, 'Toetsen BV')
  await page.goto('/bank/match')
  await expect(page.getByRole('heading', { name: 'Koppelen' })).toBeVisible()
  await hydrated(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  const strip = page.getByRole('group', { name: 'Sneltoetsen' }).first()
  await expect(strip).toBeVisible()
  await expect(strip).toContainText('Paneel openen / voorstel boeken')
  await expect(strip).toContainText('Keuze in het paneel wissen')
  await expect(strip).toContainText('Paneel sluiten')
  await expect(strip.getByText('Esc', { exact: true })).toBeVisible()
  await expect(strip.getByText('1–9')).toHaveCount(0)
  await expect(strip.getByText('X', { exact: true })).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(strip).toBeHidden()

  await page.setViewportSize({ width: 1440, height: 900 })
  const rows = queueRows(page)
  await expect(rows).toHaveCount(4)
  await page.keyboard.press('1')
  await expect(page.getByText(/Gekoppeld:|Geboekt als boeking/)).toHaveCount(0)
  await expect(rows).toHaveCount(4)
})

test('booking by hand teaches a rule, and the rule can be switched off', async ({ page }) => {
  await withStatement(page, 'Regels BV')

  await page.goto('/bank/match')
  await hydrated(page)

  const telecom = queueRows(page).filter({ hasText: 'Telecom B.V.' })
  await telecom.click()

  // Simple mode: Categorie picker shows names (Telefoon- en internetkosten = 4410).
  await chooseOption(page, 'Categorie', /Telefoon- en internetkosten/)
  await page.getByRole('button', { name: 'Boeken' }).last().click()

  await expect(page.getByText(/en onthouden voor volgende keer/)).toBeVisible()

  await page.goto('/bank')
  await expect(page.getByRole('heading', { name: 'Onthouden regels' })).toBeVisible()
  const rule = page.locator('tbody tr', { hasText: 'NL20INGB0001234567' })
  await expect(rule).toContainText('4410')
  await expect(rule).toContainText('1×')

  await rule.getByRole('button', { name: 'Uitzetten' }).click()
  await expect(rule.getByRole('button', { name: 'Aanzetten' })).toBeVisible()
})

test('Esc returns focus to the queue row and clears the panel choice', async ({ page }) => {
  await withStatement(page, 'Esc BV')
  await page.goto('/bank/match')
  await hydrated(page)

  const rows = queueRows(page)
  await expect(rows.first()).not.toBeFocused()

  await page.keyboard.press('Enter')
  // Desktop: focus lands on the account picker (no suggestions).
  await expect(page.getByRole('combobox', { name: 'Categorie' })).toBeFocused()

  // First Esc closes the open account list; the second leaves the panel and
  // returns focus to the queue (AccountPicker swallows the first Esc on purpose).
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(rows.first()).toBeFocused()
  await expect(page.getByRole('button', { name: 'Boeken' }).last()).toBeDisabled()
})

test('a hard-closed period names itself and blocks booking', async ({ page }) => {
  const name = uniqueAdminName('Hard Gesloten')
  await withStatement(page, name)
  await setMarchStatus(name, 'hard_closed')

  await page.goto('/bank/match')
  await hydrated(page)

  // Newest first: fee line in March.
  await expect(page.getByRole('heading', { name: /Kosten betalingsverkeer/ })).toBeVisible()
  await expect(page.getByText(/maart 2026 is definitief afgesloten/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Naar Boekjaren' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Boeken' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Koppelen' })).toHaveCount(0)

  const before = await queueRows(page).count()
  await page.keyboard.press('Enter')
  await expect(queueRows(page)).toHaveCount(before)
  await expect(page.getByText(/Gekoppeld:|Geboekt als boeking/)).toHaveCount(0)
})

test('soft-closed: bookkeeper is blocked without a link; owner sees Naar Boekjaren', async ({
  browser,
}) => {
  const owner = await browser.newContext()
  const keeper = await browser.newContext()

  try {
    const ownerPage = await owner.newPage()
    const name = uniqueAdminName('Voorlopig Gesloten')
    await withStatement(ownerPage, name)
    await setMarchStatus(name, 'soft_closed')

    await ownerPage.goto('/bank/match')
    await hydrated(ownerPage)
    await expect(ownerPage.getByText(/maart 2026 is voorlopig afgesloten/)).toBeVisible()
    await expect(ownerPage.getByRole('link', { name: 'Naar Boekjaren' })).toBeVisible()
    // Owner may still book into a soft-closed period.
    await expect(ownerPage.getByRole('button', { name: 'Boeken' }).last()).toBeVisible()

    const keeperPage = await keeper.newPage()
    const keeperEmail = uniqueEmail()
    await keeperPage.goto('/sign-in')
    await signIn(keeperPage, keeperEmail)
    await expect(keeperPage.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

    await ownerPage.goto('/members')
    const invite = ownerPage.locator('form', {
      has: ownerPage.getByRole('button', { name: 'Uitnodigen' }),
    })
    await invite.getByLabel('E-mail').fill(keeperEmail)
    await chooseOption(ownerPage, 'Rol', 'Boekhouder', invite)
    await ownerPage.getByRole('button', { name: 'Uitnodigen' }).click()
    await expect(ownerPage.getByText(new RegExp(`${keeperEmail} heeft nu toegang`))).toBeVisible()

    await keeperPage.goto('/bank/match')
    await hydrated(keeperPage)
    await expect(
      keeperPage.getByText(
        /maart 2026 is voorlopig afgesloten\. Alleen de eigenaar of accountant kan hierin boeken/,
      ),
    ).toBeVisible()
    await expect(keeperPage.getByRole('link', { name: 'Naar Boekjaren' })).toHaveCount(0)
    await expect(keeperPage.getByRole('button', { name: 'Boeken' })).toHaveCount(0)
    await expect(keeperPage.getByRole('button', { name: 'Koppelen' })).toHaveCount(0)

    const before = await queueRows(keeperPage).count()
    await keeperPage.keyboard.press('Enter')
    await expect(queueRows(keeperPage)).toHaveCount(before)
  } finally {
    await owner.close()
    await keeper.close()
  }
})

test('Geavanceerd shows the confidence percent on a suggestion', async ({ page }) => {
  await withStatement(page, 'Geavanceerd Percent BV')

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0099')
  await page.getByLabel('Naam', { exact: true }).fill('Grote Klant N.V.')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Grote Klant N.V.' })).toBeVisible()

  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Referentie klant').fill('KP-%')
  await page.getByLabel('Omschrijving regel 1').fill('Advieswerk')
  await page.getByLabel('Prijs regel 1').fill('1000,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('link', { name: 'journaalpost', exact: true })).toBeVisible()

  await enableAdvancedMode(page)
  await page.goto('/bank/match')
  await hydrated(page)

  const suggestion = page.getByText(/staat in de omschrijving en het bedrag klopt precies/)
  for (let step = 0; step < 4 && !(await suggestion.isVisible()); step += 1) {
    await page.keyboard.press('ArrowDown')
    await suggestion.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined)
  }
  await expect(suggestion).toBeVisible()
  await expect(page.getByText(/%/).first()).toBeVisible()
})
