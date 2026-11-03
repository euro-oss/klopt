import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import { findEntityIdByName, seedUnmatchedBankLines, setPeriodStatus } from '@klopt/db/testing'
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
 * Bank · Te boeken — Match board (#107 Phase 7 / #129).
 *
 * Keyboard: j/k move, 1–4 choose, S skip, U receipt, Z undo notice, Esc clears.
 * Period locks (a–d) keep named copy and role gates.
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

/** A fresh administration with a bank account and a statement imported. */
async function withStatement(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()

  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  // CoS example IBAN — must match statement.mt940; BankAccounts displays spaced.
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByLabel('Naam', { exact: true }).fill('Rekening-courant')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL91 ABNA 0417 1643 00')).toBeVisible()

  await expect(page.locator('[data-slot="drop-zone"] input[type="file"]')).toBeEnabled()
  await page.setInputFiles(
    '[data-slot="drop-zone"] input[type="file"]',
    join(FIXTURES, 'statement.mt940'),
  )
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await page.getByRole('button', { name: 'Importeren', exact: true }).click()
  await expect(page.getByText('4 transacties geïmporteerd.')).toBeVisible()
}

function queueRows(page: Page) {
  return page.locator('[data-slot="match-queue"] [data-row]')
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

/** Extra unmatched lines so the remaining label can hit the 500+ cap. */
async function seedExtraUnmatched(entityName: string, count: number): Promise<void> {
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  try {
    const entityId = await findEntityIdByName(database, entityName)
    if (entityId === null) throw new Error(`No entity named ${entityName}`)
    await seedUnmatchedBankLines(database, entityId, count)
  } finally {
    await closeDatabase(database)
  }
}

test('a bookkeeper works through the queue with the keyboard', async ({ page }) => {
  await withStatement(page, 'Koppelen BV')

  await page.getByRole('link', { name: '4 te boeken' }).click()
  await expect(page.getByRole('heading', { name: 'Bank' })).toBeVisible()

  const rows = queueRows(page)
  await expect(rows).toHaveCount(4)

  // No invoices exist — option 4 opens the category form.
  await expect(page.getByRole('heading', { name: 'Wat was dit?' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Een kostenpost zonder bon nog/ })).toBeVisible()

  // The selected line is the first, and the detail pane follows the selection.
  await expect(page.getByRole('heading', { name: /Kosten betalingsverkeer/ })).toBeVisible()

  await hydrated(page)

  await expect(rows.first()).not.toBeFocused()

  await page.keyboard.press('ArrowDown')
  await expect(
    page.getByRole('heading', { name: /Overboeking spaarrekening|spaarrekening/ }),
  ).toBeVisible()
  await page.keyboard.press('ArrowUp')

  // Option 4 → category form → book by hand.
  await page.keyboard.press('4')
  await chooseOption(page, 'Categorie', /Algemene kosten/)
  await page.getByRole('button', { name: 'Boeken' }).last().click()

  await expect(page.getByText('Geboekt: Kosten betalingsverkeer')).toBeVisible()
  await expect(rows).toHaveCount(3)

  await page.keyboard.press('s')
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
  await expect(page.getByRole('button', { name: /Grote Klant N\.V\./ })).toBeVisible()

  await enableAdvancedMode(page)
  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Referentie klant').fill('KP-1')
  await page.getByLabel('Omschrijving regel 1').fill('Advieswerk')
  await page.getByLabel('Prijs regel 1').fill('1000,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('link', { name: 'boeking', exact: true })).toBeVisible()

  await page.goto('/bank/match')
  await expect(page.getByRole('heading', { name: 'Bank' })).toBeVisible()

  await hydrated(page)

  const suggestion = page.getByText(/staat in de omschrijving en het bedrag klopt precies/)
  for (let step = 0; step < 4 && !(await suggestion.isVisible()); step += 1) {
    await page.keyboard.press('ArrowDown')
    await suggestion.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined)
  }

  await expect(suggestion).toBeVisible()
  await expect(page.locator('[data-slot="match-choice"][data-suggested="true"]')).toBeVisible()
  await expect(page.getByText('Voorstel').first()).toBeVisible()

  // Enter would book immediately when a suggestion is highlighted — assert we
  // have not booked yet, then press 2 (invoice choice) to confirm deliberately.
  await expect(page.getByText('Geboekt: Grote Klant N.V.')).toHaveCount(0)
  await expect(page.getByText(/Als boeking/)).toHaveCount(0)

  const before = await queueRows(page).count()
  await page.keyboard.press('2')
  await expect(page.getByText('Geboekt: Grote Klant N.V.')).toBeVisible()
  await expect(queueRows(page)).toHaveCount(before - 1)
})

test('the keys the match screen prints are the keys it answers to', async ({ page }) => {
  await withStatement(page, 'Toetsen BV')
  await page.goto('/bank/match')
  await expect(page.getByRole('heading', { name: 'Bank' })).toBeVisible()
  await hydrated(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  const hints = page.locator('.hidden.md\\:flex').filter({ hasText: 'kiezen en door' })
  await expect(hints).toBeVisible()
  await expect(hints).toContainText('overslaan')
  await expect(hints).toContainText('bon toevoegen')
  await expect(hints).toContainText('laatste terug')
  await expect(hints.getByText('1', { exact: true })).toBeVisible()
  await expect(hints.getByText('S', { exact: true })).toBeVisible()
  await expect(hints.getByText('X', { exact: true })).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(hints).toBeHidden()

  await page.setViewportSize({ width: 1440, height: 900 })
  const rows = queueRows(page)
  await expect(rows).toHaveCount(4)
  // Digit 1 with no learned cost suggestion opens the form — does not book alone.
  await page.keyboard.press('1')
  await expect(page.getByText(/^Geboekt:/)).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Categorie' })).toBeVisible()
  await expect(rows).toHaveCount(4)
})

test('booking by hand teaches a rule, and the rule can be switched off', async ({ page }) => {
  await withStatement(page, 'Regels BV')

  await page.goto('/bank/match')
  await hydrated(page)

  const telecom = queueRows(page).filter({ hasText: 'Telecom B.V.' })
  await telecom.click()
  await expect(page.getByRole('heading', { name: /Telecom B.V./ })).toBeVisible()
  await expect(page.locator('[data-slot="match-choice"]')).toHaveCount(4)

  await page.keyboard.press('4')
  await expect(page.getByRole('combobox', { name: 'Categorie' })).toBeVisible()
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

  await page.keyboard.press('4')
  await expect(page.getByRole('combobox', { name: 'Categorie' })).toBeFocused()

  await chooseOption(page, 'Categorie', /Algemene kosten/)
  await expect(page.getByRole('combobox', { name: 'Categorie' })).toHaveValue(/Algemene kosten/)
  await expect(page.getByRole('button', { name: 'Boeken' }).last()).toBeEnabled()

  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(rows.first()).toBeFocused()
  await expect(page.getByRole('combobox', { name: 'Categorie' })).toHaveCount(0)
})

test('a hard-closed period names itself and blocks booking', async ({ page }) => {
  const name = uniqueAdminName('Hard Gesloten')
  await withStatement(page, name)
  await setMarchStatus(name, 'hard_closed')

  await page.goto('/bank/match')
  await hydrated(page)

  await expect(page.getByRole('heading', { name: /Kosten betalingsverkeer/ })).toBeVisible()
  await expect(page.getByText(/Maart 2026 is definitief afgesloten/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Naar Boekjaren' })).toHaveCount(0)
  await expect(page.locator('[data-slot="match-choice"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Boeken' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Koppelen' })).toHaveCount(0)

  const before = await queueRows(page).count()
  await page.keyboard.press('Enter')
  await expect(queueRows(page)).toHaveCount(before)
  await expect(page.getByText(/^Geboekt:/)).toHaveCount(0)
  await expect(page.getByText(/Als boeking/)).toHaveCount(0)
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
    await expect(
      ownerPage.getByText(/Maart 2026 is voorlopig afgesloten\. Je kunt hier nog in boeken/),
    ).toBeVisible()
    await expect(ownerPage.getByRole('link', { name: 'Naar Boekjaren' })).toBeVisible()
    await expect(ownerPage.locator('[data-slot="match-choice"]')).toHaveCount(4)

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
        /Maart 2026 is voorlopig afgesloten\. Alleen de eigenaar of accountant kan hierin boeken/,
      ),
    ).toBeVisible()
    await expect(keeperPage.getByRole('link', { name: 'Naar Boekjaren' })).toHaveCount(0)
    await expect(keeperPage.locator('[data-slot="match-choice"]')).toHaveCount(0)
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
  await expect(page.getByRole('button', { name: /Grote Klant N\.V\./ })).toBeVisible()

  await enableAdvancedMode(page)
  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Referentie klant').fill('KP-%')
  await page.getByLabel('Omschrijving regel 1').fill('Advieswerk')
  await page.getByLabel('Prijs regel 1').fill('1000,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('link', { name: 'boeking', exact: true })).toBeVisible()

  await page.goto('/bank/match')
  await hydrated(page)

  const suggestion = page.getByText(/staat in de omschrijving en het bedrag klopt precies/)
  for (let step = 0; step < 4 && !(await suggestion.isVisible()); step += 1) {
    await page.keyboard.press('ArrowDown')
    await suggestion.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined)
  }
  await expect(suggestion).toBeVisible()

  const selected = page.locator('[data-slot="match-choice"][data-suggested="true"]')
  await expect(selected).toBeVisible()
  await expect(selected).toContainText('99%')
  await expect(selected).toContainText('factuurnummer')
})

test('the remaining label caps only above 500 lines', async ({ page }) => {
  const name = uniqueAdminName('VijfhonderdPlus')
  await withStatement(page, name)
  await seedExtraUnmatched(name, 497)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/bank/match')
  await hydrated(page)
  // Desktop + phone header both render the remaining label (#164); at 1440
  // only the desktop header copy is visible.
  const remaining = page.getByText('500+ regels nog te boeken').filter({ visible: true })
  await expect(remaining).toHaveCount(1)
  await expect(remaining).toBeVisible()
  await expect(queueRows(page)).toHaveCount(500)
})
