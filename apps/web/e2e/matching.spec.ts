import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { chooseOption, DATABASE_URL, hydrated, OUTBOX, signIn, uniqueEmail } from './support'

/**
 * The koppelwachtrij, in a browser.
 *
 * The keyboard is the feature — spec 7.4 asks for "a one-keystroke confirm" —
 * so the assertions are about what a keystroke does, which is exactly the kind
 * of thing no handler test can see.
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

  // Enabled first: the input is `disabled` until React has taken over, and
  // setting files on a disabled input silently does nothing.
  await expect(page.locator('input[type="file"]')).toBeEnabled()

  await page.setInputFiles('input[type="file"]', join(FIXTURES, 'statement.mt940'))
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await page.getByRole('button', { name: 'Inlezen', exact: true }).click()
  await expect(page.getByText('4 transacties ingelezen.')).toBeVisible()
}

test('a bookkeeper works through the queue with the keyboard', async ({ page }) => {
  await withStatement(page, 'Koppelen BV')

  await page.getByRole('link', { name: '4 koppelen' }).click()
  await expect(page.getByRole('heading', { name: 'Koppelen' })).toBeVisible()

  const queue = page.getByRole('list', { name: 'Wachtrij' }).getByRole('listitem')
  await expect(queue).toHaveCount(4)

  // No invoices exist, so nothing is suggested and a choice has to be made.
  await expect(page.getByText('Geen voorstel. Kies zelf een grootboekrekening.')).toBeVisible()

  // The selected line is the first, and the detail pane follows the selection.
  await expect(page.getByRole('button', { name: /Kosten betalingsverkeer/ })).toBeVisible()

  // The arrow keys are listened for in an effect, so a keystroke sent before
  // React has taken over is simply lost.
  await hydrated(page)

  // Down and up move the selection, and the detail pane keeps up.
  await page.keyboard.press('ArrowDown')
  await expect(page.getByText('Overboeking spaarrekening').last()).toBeVisible()
  await page.keyboard.press('ArrowUp')

  // Book the selected line by hand.
  await chooseOption(page, 'Zelf kiezen', /^4900 /)
  await page.getByRole('button', { name: 'Boeken' }).last().click()

  await expect(page.getByText(/Geboekt als journaalpost/)).toBeVisible()
  await expect(queue).toHaveCount(3)

  // Skipping is the other half of getting through a queue, and it is a button:
  // `x` used to do it in one keystroke, which made "not this one" as cheap as
  // booking (Alpha 4 oracle, docs/keyboard-map.md).
  await page.getByRole('button', { name: 'Overslaan' }).click()
  await expect(page.getByText('Overgeslagen.')).toBeVisible()
  await expect(queue).toHaveCount(2)
})

test('a payment is booked by confirming the candidate, not by trusting the top one', async ({
  page,
}) => {
  await withStatement(page, 'Koppelen Factuur BV')

  // The fixture's first line says "Factuur 2026-0001" and is 1210,00 — the
  // amount of an invoice for 1000,00 plus 21%. So make exactly that invoice.
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

  // The keys are listened for in an effect; before React has taken over a
  // keystroke is simply lost.
  await hydrated(page)

  // The queue is newest first, so walk down to the payment.
  const suggestion = page.getByText(/staat in de omschrijving en het bedrag klopt precies/)
  for (let step = 0; step < 4 && !(await suggestion.isVisible()); step += 1) {
    await page.keyboard.press('ArrowDown')
    // Suggestions are fetched for the line that was just selected, so let the
    // answer arrive before deciding to walk past it.
    await suggestion.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined)
  }

  await expect(suggestion).toBeVisible()
  await expect(page.getByText('99%')).toBeVisible()

  // Two keystrokes, and the second one is aimed. `Enter` from the queue moves
  // into the panel and lands on the candidate that would be booked — it does not
  // book the top suggestion from the queue, which is the thing Alpha 4 took out:
  // the line being agreed to was off to the side of the key being pressed.
  await page.keyboard.press('Enter')
  await expect(page.locator('li[aria-current="true"]').filter({ hasText: '99%' })).toBeFocused()
  await expect(page.getByText(/Geboekt als journaalpost/)).toHaveCount(0)

  await page.keyboard.press('Enter')
  await expect(page.getByText(/Geboekt als journaalpost/)).toBeVisible()
})

test('the keys the match screen prints are the keys it answers to', async ({ page }) => {
  // The registry is the source of the chrome, so this is really a check that the
  // screen stopped promising `1`–`9` and `x` when it stopped listening for them.
  await withStatement(page, 'Toetsen BV')
  await page.goto('/bank/match')
  await expect(page.getByRole('heading', { name: 'Koppelen' })).toBeVisible()
  await hydrated(page)

  const panel = page.getByRole('complementary', { name: 'Sneltoetsen' })
  await expect(panel).toContainText('Paneel openen / voorstel boeken')
  await expect(panel).toContainText('Keuze in het paneel wissen')
  await expect(panel).toContainText('Paneel sluiten')
  await expect(panel.getByText('1–9')).toHaveCount(0)
  await expect(panel.getByText('X', { exact: true })).toHaveCount(0)

  // And a digit no longer books anything.
  const queue = page.getByRole('list', { name: 'Wachtrij' }).getByRole('listitem')
  await expect(queue).toHaveCount(4)
  await page.keyboard.press('1')
  await expect(page.getByText(/Geboekt als journaalpost/)).toHaveCount(0)
  await expect(queue).toHaveCount(4)
})

/**
 * Un-quarantined: the cause was in this file, not in the learned-rules view.
 *
 * The quarantine note read the symptom correctly — the confirmation appears,
 * so a rule *is* learned, but no row for the IBAN turns up on `/bank`. The
 * reason is one line further up: the click that selects the Telecom line
 * landed before React had taken over, so it selected nothing, and the booking
 * went to whichever line the queue had opened on. That line is the bank
 * charges, whose rule is keyed on its description. The screen was right and
 * the test was booking something else.
 *
 * It fails the same way outside CI once the first paint is slow enough, which
 * is how it was caught. With the wait below it passed twelve consecutive runs
 * and two full-suite runs locally.
 */
test('booking by hand teaches a rule, and the rule can be switched off', async ({ page }) => {
  await withStatement(page, 'Regels BV')

  await page.goto('/bank/match')

  // A queue row is a plain button until React has taken over, so a click that
  // lands before then selects nothing and the booking below goes to whichever
  // line the queue opened on.
  await hydrated(page)

  // The direct debit from Telecom B.V. has an IBAN, so a choice made here is
  // worth remembering.
  const telecom = page
    .getByRole('list', { name: 'Wachtrij' })
    .getByRole('button', { name: /Telecom B.V./ })
  await telecom.click()

  await chooseOption(page, 'Zelf kiezen', /^4410 /)
  await page.getByRole('button', { name: 'Boeken' }).last().click()

  await expect(page.getByText(/en onthouden voor volgende keer/)).toBeVisible()

  // Visible, with what it matches on and how often it has fired.
  await page.goto('/bank')
  await expect(page.getByRole('heading', { name: 'Onthouden regels' })).toBeVisible()
  const rule = page.locator('tbody tr', { hasText: 'NL20INGB0001234567' })
  await expect(rule).toContainText('4410')
  await expect(rule).toContainText('1×')

  // And editable, which is the other half of what spec 7.4 asks for.
  await rule.getByRole('button', { name: 'Uitzetten' }).click()
  await expect(rule.getByRole('button', { name: 'Aanzetten' })).toBeVisible()
})
