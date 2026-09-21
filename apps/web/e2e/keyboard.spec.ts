import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

/** The copy-as-TSV test writes to the clipboard and then reads it back. */
test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

/**
 * The keyboard, in a browser.
 *
 * The registry has printed its keys in the sidebar since M0 and nothing
 * listened for them. Only a browser can check that they now do something, and
 * only a browser can check the two things most likely to be wrong: that a bare
 * letter does not fire while somebody is typing, and that a screen with its own
 * keys does not fight the global ones.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

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

/** A supplier invoice, as one arrives: the postvak reads this one. */
const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>F-2026-0042</cbc:ID>
  <cbc:IssueDate>2026-02-10</cbc:IssueDate>
  <cbc:DueDate>2026-03-12</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>Leverancier B.V.</cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme><cbc:CompanyID>NL987654321B01</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">210.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">1000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1210.00</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Kantoorartikelen</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
  </cac:InvoiceLine>
</Invoice>`

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Toetsenbord BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await theKeyboardIsLive(page)
}

/**
 * Waits until the keys do something.
 *
 * The listener is registered in an effect, so it exists only after hydration —
 * and the sidebar only prints a shortcut once it works, which makes the hint
 * the honest thing to wait for. Pressing before then loses the keystroke, and
 * an assertion retried afterwards cannot get it back.
 */
async function theKeyboardIsLive(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: /Journaalposten/ }).locator('kbd')).toHaveCount(1)
}

/**
 * What has the focus, as a tag and a name.
 *
 * Reported rather than asserted on directly, because "focus is never lost to
 * `<body>`" and "Tab reaches the field" are both claims about the same thing,
 * and a failure that says where focus actually ended up is a failure somebody
 * can fix.
 */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement
    if (element === null) return 'nothing'
    // The body's own text is the whole page, which would answer to any name.
    if (element === document.body) return 'BODY'
    const labelled = element.id === '' ? null : document.querySelector(`label[for="${element.id}"]`)
    const name = element.getAttribute('aria-label') ?? labelled?.textContent ?? element.textContent
    const short = (name ?? '').replace(/\s+/gu, ' ').trim().slice(0, 60)
    return `${element.tagName} ${short}`.trim()
  })
}

/** Tab until the named thing has the focus. Nothing is clicked, ever. */
async function tabTo(page: Page, name: RegExp, presses = 80): Promise<void> {
  for (let press = 0; press < presses; press += 1) {
    if (name.test(await focused(page))) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`Tab never reached ${String(name)} — focus ended on ${await focused(page)}.`)
}

/** The same, backwards: out of a panel and back to the thing that opened it. */
async function shiftTabTo(page: Page, name: RegExp, presses = 20): Promise<void> {
  for (let press = 0; press < presses; press += 1) {
    if (name.test(await focused(page))) return
    await page.keyboard.press('Shift+Tab')
  }
  throw new Error(
    `Shift-Tab never reached ${String(name)} — focus ended on ${await focused(page)}.`,
  )
}

/** Nothing on this screen may leave the focus on the document body. */
async function focusIsSomewhere(page: Page): Promise<void> {
  expect(await focused(page)).not.toMatch(/^BODY/)
}

test('the prefixes in the sidebar actually go there', async ({ page }) => {
  await anAdministration(page)

  await page.keyboard.press('g')
  // The armed prefix is shown: a shortcut that silently waits is one people
  // assume did not work.
  await expect(page.getByText('G …')).toBeVisible()
  await page.keyboard.press('j')
  await expect(page.getByRole('heading', { name: 'Journaalposten' })).toBeVisible()

  await page.keyboard.press('g')
  await page.keyboard.press('r')
  await expect(page.getByRole('heading', { name: 'Relaties' })).toBeVisible()

  await page.keyboard.press('n')
  await page.keyboard.press('i')
  await expect(page).toHaveURL(/\/purchases\/new$/)
})

test('a prefix expires rather than hijacking the next thing you type', async ({ page }) => {
  await anAdministration(page)

  await page.keyboard.press('g')
  await expect(page.getByText('G …')).toBeVisible()

  // The window is 1.5 seconds (docs/keyboard-map.md). The budget here is much
  // longer on purpose: what is being asserted is that the prefix expires, not
  // how fast, and a tight bound turns a busy machine into a red suite.
  await expect(page.getByText('G …')).toBeHidden({ timeout: 15_000 })

  await page.keyboard.press('j')
  // Still on the dashboard: the prefix went, so `j` meant nothing.
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
})

test('Escape drops a half-typed shortcut', async ({ page }) => {
  await anAdministration(page)

  await page.keyboard.press('g')
  await expect(page.getByText('G …')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('G …')).toBeHidden()

  await page.keyboard.press('j')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
})

test('a bare letter does not fire while somebody is typing', async ({ page }) => {
  // The one that would make the feature unusable: `g` is the first letter of
  // half the words a bookkeeper types.
  await anAdministration(page)
  await page.goto('/contacts')

  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  const name = page.getByLabel('Naam', { exact: true })
  await name.fill('Grote Groenteboer')

  await expect(name).toHaveValue('Grote Groenteboer')
  await expect(page.getByRole('heading', { name: 'Relaties' })).toBeVisible()
})

test('the palette opens on Cmd-K and goes where you pick', async ({ page }) => {
  await anAdministration(page)

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()

  await page.getByLabel('Zoek een scherm').fill('betal')
  await page.keyboard.press('Enter')

  await expect(page.getByRole('heading', { name: 'Betalingen' })).toBeVisible()
  await expect(palette).toBeHidden()
})

test('the help sheet is the keyboard map, generated from the registry', async ({ page }) => {
  await anAdministration(page)

  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Sneltoetsen' })
  await expect(help).toBeVisible()

  // Including the screen-local keys, which the palette cannot offer because it
  // cannot run them from here.
  await expect(help).toContainText('Paneel openen / voorstel boeken')
  await expect(help).toContainText('Commandopalet')

  await page.keyboard.press('Escape')
  await expect(help).toBeHidden()
})

/** A form that has finished hydrating: the post button is disabled until then. */
async function anEntryForm(page: Page): Promise<void> {
  await page.goto('/entries/new')
  await expect(page.getByRole('button', { name: 'Boeken', exact: true })).toBeEnabled()
}

test('an account is found by its name, not only by its number', async ({ page }) => {
  // The whole reason the `<datalist>` over account numbers was not enough:
  // somebody who thinks "debiteuren" rather than "1300" could not work.
  await anAdministration(page)
  await anEntryForm(page)

  const account = page.getByRole('combobox', { name: 'Rekening regel 1' })
  await account.pressSequentially('deb')

  const options = page.getByRole('listbox', { name: 'Rekeningen' })
  await expect(options.getByRole('option', { name: /^1300 Debiteuren/ })).toBeVisible()

  // Enter takes the highlighted match, and the name of what was chosen stays on
  // screen next to the number it was chosen by.
  await page.keyboard.press('Enter')
  await expect(account).toHaveValue('1300')
  await expect(options).toBeHidden()
  await expect(page.getByText('Debiteuren').first()).toBeVisible()
})

test('Escape leaves an account field as it was', async ({ page }) => {
  await anAdministration(page)
  await anEntryForm(page)

  const account = page.getByRole('combobox', { name: 'Rekening regel 1' })
  await account.pressSequentially('4400')
  await page.keyboard.press('Enter')
  await expect(account).toHaveValue('4400')

  await account.pressSequentially('kantoor')
  await page.keyboard.press('Escape')
  await expect(account).toHaveValue('4400')
  await expect(page.getByRole('listbox', { name: 'Rekeningen' })).toBeHidden()
})

test('an account nobody has is said out loud, not swallowed', async ({ page }) => {
  await anAdministration(page)
  await anEntryForm(page)

  const account = page.getByRole('combobox', { name: 'Rekening regel 1' })
  await account.pressSequentially('9999')
  await expect(page.getByRole('listbox', { name: 'Rekeningen' })).toContainText(
    'Geen rekening gevonden.',
  )

  // Leaving the field keeps what was typed and says what is wrong with it:
  // putting the old value back would leave somebody reading a number they did
  // not type, and dropping it would lose the typing.
  await page.keyboard.press('Tab')
  await expect(account).toHaveValue('9999')
  await expect(page.getByText('Rekening 9999 staat niet in dit grootboek.')).toBeVisible()
})

test('the arrows move through the matches and Enter takes the highlighted one', async ({
  page,
}) => {
  await anAdministration(page)
  await anEntryForm(page)

  // "debiteuren" is in two account names, so there is something to move through.
  const account = page.getByRole('combobox', { name: 'Rekening regel 1' })
  await account.pressSequentially('debiteuren')

  const options = page.getByRole('listbox', { name: 'Rekeningen' })
  await expect(options.getByRole('option')).toHaveCount(2)
  await expect(options.getByRole('option').first()).toContainText('1300 Debiteuren')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(account).toHaveValue('1310')
})

test('a ledger table has a cursor, type-ahead and a copy for a spreadsheet', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/accounts')
  await expect(page.getByRole('heading', { name: 'Grootboek' })).toBeVisible()

  // Reached by Tab, because a table nobody can get to from the keyboard has no
  // keyboard. One row is in the tab order; the arrows do the rest.
  await tabTo(page, /^TR /)
  const cursor = page.locator('tr[aria-current="true"]')
  const first = await cursor.textContent()

  await page.keyboard.press('j')
  await expect(cursor).not.toHaveText(first ?? '')
  await page.keyboard.press('ArrowUp')
  await expect(cursor).toHaveText(first ?? '')

  // Type-ahead on the column the table is sorted by — the account number.
  await page.keyboard.press('4')
  await page.keyboard.press('4')
  await expect(cursor).toContainText('4400')
  await expect(cursor).toContainText('Kantoorkosten')

  // Every loaded row, then the clipboard, then a spreadsheet.
  await page.keyboard.press('ControlOrMeta+a')
  await expect(page.getByRole('status')).toContainText(/regels geselecteerd/)
  await page.keyboard.press('ControlOrMeta+c')
  await expect(page.getByRole('status')).toContainText(/regels gekopieerd/)

  const tsv = await page.evaluate(() => navigator.clipboard.readText())
  const [header, ...body] = tsv.split('\n')
  // Columns intact: a header row, then a row per account, tab-separated.
  expect(header).toBe(['Nummer', 'Omschrijving', 'Soort', 'D/C', 'RGS', ''].join('\t'))
  expect(body.some((line) => line.startsWith('1300\tDebiteuren\t'))).toBe(true)
  expect(body.length).toBeGreaterThan(20)
})

test('the cursor stays on its row when the list underneath it changes', async ({ page }) => {
  await anAdministration(page)
  await page.goto('/accounts')
  await expect(page.getByRole('heading', { name: 'Grootboek' })).toBeVisible()

  await tabTo(page, /^TR /)
  await page.keyboard.press('End')
  const cursor = page.locator('tr[aria-current="true"]')
  const last = await cursor.textContent()

  // A reload is the honest version of "more rows arrived": same table, rebuilt.
  await page.keyboard.press('j')
  await expect(cursor).toHaveText(last ?? '')
})

test('Cmd-D duplicates a line and Cmd-Backspace takes one away', async ({ page }) => {
  // Both were in the registry and printed in the help sheet, bound to nothing.
  await anAdministration(page)
  await anEntryForm(page)

  const account = page.getByRole('combobox', { name: 'Rekening regel 1' })
  await account.pressSequentially('4400')
  await page.keyboard.press('Enter')

  await page.getByLabel('Omschrijving regel 1').press('ControlOrMeta+d')
  await expect(page.getByRole('combobox', { name: 'Rekening regel 2' })).toHaveValue('4400')
  await expect(page.getByRole('combobox', { name: 'Rekening regel 3' })).toBeVisible()

  // On an empty field the key is the line's. The row goes and the copy with it.
  await page.getByLabel('Omschrijving regel 2').press('ControlOrMeta+Backspace')
  await expect(page.getByRole('combobox', { name: 'Rekening regel 3' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Rekening regel 1' })).toHaveValue('4400')
})

test('Cmd-Backspace in a half-typed amount is the browser’s, not the line’s', async ({ page }) => {
  await anAdministration(page)
  await anEntryForm(page)

  const debit = page.getByLabel('Debet regel 1')
  await debit.pressSequentially('121,00')
  await debit.press('ControlOrMeta+Backspace')

  // Two rows still, because the key cleared text rather than the line.
  await expect(page.getByRole('combobox', { name: 'Rekening regel 2' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Rekening regel 3' })).toHaveCount(0)
})

test('nothing posts without showing what it is about to post', async ({ page }) => {
  await anAdministration(page)
  await anEntryForm(page)

  await page.getByLabel('Omschrijving', { exact: true }).fill('Kas naar bank')
  await page.getByRole('combobox', { name: 'Rekening regel 1' }).pressSequentially('1100')
  await page.keyboard.press('Enter')
  await page.getByLabel('Debet regel 1').fill('250,00')

  // One line: the shortcut says what is missing rather than posting or doing
  // nothing at all, which is what a key bound to a refusal looks like.
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(
    page.getByText('Een journaalpost heeft minstens twee regels met een rekening.'),
  ).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Dit wordt geboekt' })).toHaveCount(0)

  await page.getByRole('combobox', { name: 'Rekening regel 2' }).pressSequentially('1000')
  await page.keyboard.press('Enter')

  // Two lines and still no balance, which is the other refusal.
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByText('Debet en credit zijn niet gelijk.')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Dit wordt geboekt' })).toHaveCount(0)

  // `=` fills the amount that balances the entry.
  await page.getByLabel('Credit regel 2').press('=')

  await page.keyboard.press('ControlOrMeta+Enter')
  const confirmation = page.getByRole('dialog', { name: 'Dit wordt geboekt' })
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText('MEM')
  await expect(confirmation).toContainText('Kas naar bank')

  // Escape gets back to the draft with everything still in it.
  await page.keyboard.press('Escape')
  await expect(confirmation).toBeHidden()
  await expect(page.getByLabel('Debet regel 1')).toHaveValue('250,00')
  await focusIsSomewhere(page)

  // Asked, then confirmed: the second press posts, and only once.
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(confirmation).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: /MEM 1/ })).toBeVisible()
})

/**
 * The claim this whole issue is about: a day's work with the hands on the keys.
 *
 * Everything after the setup is typed. There is not a single `click()` below
 * this comment, deliberately — a mouse anywhere in the happy path is the bug
 * this test exists to catch, and the only way to be sure is to have no way of
 * clicking.
 */
test('issuing an invoice, matching the bank and clearing the postvak needs no mouse', async ({
  page,
}) => {
  await anAdministration(page)

  // Setup, with a mouse: a customer who is also the supplier on the document in
  // the postvak, a bank account, a statement, and a document that arrived.
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('REL-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Leverancier B.V.')
  // The VAT number is what the postvak matches the arriving document on.
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL987654321B01')
  await page.getByRole('checkbox', { name: /Klant/ }).check()
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Leverancier B.V.').first()).toBeVisible()

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

  await page.goto('/inbox')
  await expect(page.locator('input[type="file"]')).toBeEnabled()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'inkomende-factuur.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(UBL, 'utf8'),
  })
  await expect(page.getByText('F-2026-0042 · Leverancier B.V.')).toBeVisible()

  // ── From here on, the keyboard and nothing else. ───────────────────────────

  await page.goto('/')
  await theKeyboardIsLive(page)

  // A sales invoice: `n` then `f`.
  await page.keyboard.press('n')
  await page.keyboard.press('f')
  await expect(page.getByRole('heading', { name: 'Nieuwe factuur' })).toBeVisible()
  await focusIsSomewhere(page)

  await tabTo(page, /Klant/)
  // A shadcn select, worked the way Radix intends: open, choose, closed.
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('combobox', { name: 'Klant', exact: true })).toHaveText(/REL-0001/)

  await page.getByLabel('Omschrijving regel 1').pressSequentially('Advieswerk januari')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Prijs regel 1').fill('1000,00')

  // The account is chosen by typing at it, and Tab takes the highlighted match
  // and moves on — the picker contract from docs/keyboard-map.md.
  const revenue = page.getByRole('combobox', { name: 'Grootboek regel 1' })
  await revenue.pressSequentially('8000')
  await page.keyboard.press('Tab')
  await expect(revenue).toHaveValue('8000')

  // The keystroke shows what it is about to save, and saves on the second press.
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByRole('dialog', { name: 'Dit wordt opgeslagen' })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByRole('heading', { name: /Factuur/ })).toBeVisible()
  // After a navigation the focus is on the screen that just opened, not on the
  // body: the next Tab starts here rather than at the top of the window.
  await focusIsSomewhere(page)

  // Koppelen: `g` then `o`, the cursor down a line, an account typed in, booked.
  await page.keyboard.press('g')
  await page.keyboard.press('o')
  await expect(page.getByRole('heading', { name: 'Koppelen' })).toBeVisible()

  const queue = page.getByRole('list', { name: 'Wachtrij' }).getByRole('button')
  await expect(queue).toHaveCount(4)
  await page.keyboard.press('j')

  const manual = page.getByRole('combobox', { name: 'Zelf kiezen' })
  await manual.pressSequentially('4400')
  await page.keyboard.press('Enter')
  await expect(manual).toHaveValue('4400')

  await tabTo(page, /^BUTTON Boeken$/)
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Geboekt als journaalpost/)).toBeVisible()
  await expect(queue).toHaveCount(3)

  // Het postvak: `g` then `e`, open the document, book it as a draft invoice.
  await page.keyboard.press('g')
  await page.keyboard.press('e')
  await expect(page.getByRole('heading', { name: 'Postvak' })).toBeVisible()
  await focusIsSomewhere(page)

  // The cursor is on the first document, `Enter` opens it, and the focus lands
  // in the panel rather than on the card.
  await tabTo(page, /^LI /)
  await page.keyboard.press('Enter')

  const account = page.getByRole('combobox', { name: 'Grootboek regel 1' })
  await account.pressSequentially('4400')
  await page.keyboard.press('Enter')
  await expect(account).toHaveValue('4400')

  await tabTo(page, /^BUTTON Concept maken/)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Inkoopfactuur F-2026-0042' })).toBeVisible()
  await focusIsSomewhere(page)
})

test('the postvak is worked with the same keys as everything else', async ({ page }) => {
  // The gap this closes: the postvak was a column of cards and a Tab key, which
  // broke the invoice → koppelen → postvak spine at its last screen.
  await anAdministration(page)

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Leverancier B.V.')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL987654321B01')
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Leverancier B.V.' })).toBeVisible()

  await page.goto('/inbox')
  await expect(page.locator('input[type="file"]')).toBeEnabled()
  for (const name of ['een.xml', 'twee.xml']) {
    await page.locator('input[type="file"]').setInputFiles({
      name,
      mimeType: 'application/xml',
      buffer: Buffer.from(UBL.replace('F-2026-0042', `F-${name.slice(0, 4)}`), 'utf8'),
    })
  }
  const cards = page.getByRole('list', { name: 'Wat er binnen is gekomen' }).getByRole('listitem')
  await expect(cards).toHaveCount(2)

  // The keys are printed on the screen they work on, not only in the ? sheet:
  // a panel in the corner with the screen's whole keyboard, and a strip along
  // the bottom of each pane.
  const panel = page.getByRole('complementary', { name: 'Sneltoetsen' })
  await expect(panel).toContainText('Concept maken')
  await expect(panel.getByText('A', { exact: true })).toBeVisible()
  await expect(panel.getByText('S', { exact: true })).toBeVisible()
  // The same key, twice over: once in the corner panel and once in the strip
  // under the list it moves.
  await expect(page.getByText('Volgend stuk')).toHaveCount(2)

  await tabTo(page, /^LI /)
  const cursor = page.locator('li[aria-current="true"]')
  const first = await cursor.textContent()

  await page.keyboard.press('j')
  await expect(cursor).not.toHaveText(first ?? '')
  await page.keyboard.press('k')
  await expect(cursor).toHaveText(first ?? '')

  // `s` sets the document aside, with the reason field focused — a field rather
  // than a browser dialogue, so the flow never leaves the keyboard.
  await page.keyboard.press('s')
  await expect(page.getByLabel('Waarom terzijde?')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Waarom terzijde?')).toHaveCount(0)
  await focusIsSomewhere(page)

  // `a` opens the coding first and books the second time: nothing is approved
  // without being looked at.
  await page.keyboard.press('a')
  // The focus lands in the panel, on its first field, rather than staying on the
  // card: the next thing to do is check the coding.
  expect(await focused(page)).toMatch(/Leverancier/)

  await tabTo(page, /Grootboek regel 1/)
  const account = page.getByRole('combobox', { name: 'Grootboek regel 1' }).first()
  await account.pressSequentially('4400')
  await page.keyboard.press('Enter')

  // Back out to the card the panel belongs to, and `a` again books it.
  await shiftTabTo(page, /^LI /)
  await page.keyboard.press('a')
  await expect(page.getByRole('heading', { name: /^Inkoopfactuur F-/ })).toBeVisible()
})
