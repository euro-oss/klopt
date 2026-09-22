import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, signOut, uniqueEmail } from './support'

/**
 * De auditfile, er weer in.
 *
 * `handleImportAuditFile` has its own tests, including an export-then-import
 * round trip against a real Postgres. What those cannot see is the screen, and
 * the screen is the whole of what #6 adds: a file picker, a preview that reports
 * what would happen without writing, and — the part Product decided before any
 * of it was built — an honest refusal for a file the chart cannot take.
 *
 * That refusal is the interesting test. There is no chart-create operation in
 * the API and expanding the chart from a file is #15, so a file naming an
 * account this administration does not have has exactly one correct outcome: a
 * specific message and no import button. Never a stack trace, never a silent
 * partial import.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

/**
 * A fresh session, even when one is already open.
 *
 * The round-trip tests want two administrations and one browser, and `/sign-in`
 * bounces a signed-in visitor to the dashboard — so the way to the form is
 * through the sidebar's own sign-out (one click inside the account menu when
 * there is a shell, or the plain Afmelden button on the no-administration
 * screen).
 */
async function anAdministration(page: Page, name: string): Promise<void> {
  await page.goto('/')
  if ((await page.getByRole('region', { name: 'Profiel' }).count()) > 0) {
    await signOut(page)
    await expect(page.getByLabel('E-mail')).toBeVisible()
  } else if ((await page.getByRole('button', { name: 'Afmelden' }).count()) > 0) {
    await page.getByRole('button', { name: 'Afmelden' }).click()
    await expect(page.getByLabel('E-mail')).toBeVisible()
  }

  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()

  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

async function anEntry(page: Page, description: string, amount: string): Promise<void> {
  await page.goto('/entries/new')
  await expect(page.getByRole('button', { name: 'Boeken', exact: true })).toBeEnabled()

  await page.getByLabel('Omschrijving', { exact: true }).fill(description)
  await page.getByRole('combobox', { name: 'Rekening regel 1' }).pressSequentially('4400')
  await page.keyboard.press('Enter')
  await page.getByLabel('Debet regel 1').fill(amount)
  await page.getByRole('combobox', { name: 'Rekening regel 2' }).pressSequentially('1100')
  await page.keyboard.press('Enter')
  await page.getByLabel('Credit regel 2').fill(amount)

  await page.getByRole('button', { name: 'Boeken', exact: true }).click()
  await page.getByRole('button', { name: 'Definitief boeken', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Dit wordt geboekt' })).toBeHidden()
}

/** The administration's own auditfile, read through the session's cookies. */
async function exported(page: Page, year: string): Promise<string> {
  const response = await page.request.get(`/api/v1/exports/audit-file?fiscalYear=${year}`)
  expect(response.ok()).toBe(true)
  return response.text()
}

test('import lives beside export, and the dashboard points at both', async ({ page }) => {
  await anAdministration(page, 'Heen En Terug BV')

  await page.getByRole('link', { name: 'Auditfile importeren' }).click()
  await expect(page).toHaveURL(/\/audit-file$/)
  await expect(page.getByRole('heading', { name: 'Auditfile' })).toBeVisible()

  // The pair, on one screen: the same door, in both directions.
  await expect(page.getByRole('link', { name: 'Auditfile downloaden' })).toBeVisible()
  await expect(page.getByLabel('XAF-bestand')).toBeVisible()
})

test('a file the chart already covers is previewed and then imported', async ({ page }) => {
  const year = String(new Date().getUTCFullYear())

  await anAdministration(page, 'Overnemende Boeken BV')
  await anEntry(page, 'Kantoorbenodigdheden', '250,00')
  const xml = await exported(page, year)

  // A second administration with the same seeded chart, which is the case the
  // alpha supports: the file matches, so nothing has to be created.
  await anAdministration(page, 'Ontvangende Boeken BV')
  await page.goto('/audit-file')
  await hydrated(page)

  await page
    .getByLabel('XAF-bestand')
    .setInputFiles({ name: 'auditfile.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) })

  await expect(page.getByText('Wat dit bestand zou doen')).toBeVisible()
  await expect(page.getByText('Nieuwe rekeningen')).toBeVisible()
  // Nothing new, so the import is on offer.
  const doIt = page.getByRole('button', { name: 'Importeren', exact: true })
  await expect(doIt).toBeEnabled()

  await doIt.click()
  await expect(page.getByText(new RegExp(`journaalposten in boekjaar ${year}`))).toBeVisible()

  // Really posted, into the receiving administration's journal.
  await page.goto('/entries')
  await expect(page.getByRole('cell', { name: 'Kantoorbenodigdheden' })).toHaveCount(1)

  // The same file again, all the way through: chosen, previewed, confirmed. It
  // must post nothing the second time. The idempotency key is derived from the
  // file rather than minted per attempt, so the second import replays the first
  // one instead of writing a second set of the same entries — which is what a
  // fresh key used to do, `sourceDocumentRef` and all.
  await page.goto('/audit-file')
  await hydrated(page)
  await page
    .getByLabel('XAF-bestand')
    .setInputFiles({ name: 'auditfile.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) })
  await expect(page.getByText('Wat dit bestand zou doen')).toBeVisible()
  await page.getByRole('button', { name: 'Importeren', exact: true }).click()
  await expect(
    page.getByText(/Hetzelfde bestand nog een keer aanbieden boekt niets extra/),
  ).toBeVisible()

  await page.goto('/entries')
  await expect(page.getByRole('cell', { name: 'Kantoorbenodigdheden' })).toHaveCount(1)
})

test('a file naming an account this chart does not have is refused, in words', async ({ page }) => {
  const year = String(new Date().getUTCFullYear())

  await anAdministration(page, 'Vreemd Grootboek BV')
  await anEntry(page, 'Kantoorbenodigdheden', '250,00')

  // The same file with one account renamed to a number nothing answers to.
  // Element text rather than a bare number, so an amount cannot be caught by it.
  const doctored = (await exported(page, year)).replaceAll('>4400<', '>4999<')
  expect(doctored).toContain('>4999<')

  await page.goto('/audit-file')
  await hydrated(page)
  await page
    .getByLabel('XAF-bestand')
    .setInputFiles({ name: 'vreemd.xml', mimeType: 'text/xml', buffer: Buffer.from(doctored) })

  await expect(page.getByText('Wat dit bestand zou doen')).toBeVisible()

  // Named, counted, and refused — and the button that would have failed is not
  // there to be pressed.
  await expect(
    page.getByText(/rekeningen en .* dagboeken die deze administratie niet heeft/),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Importeren', exact: true })).toHaveCount(0)

  // What it points at, and what it must *not* say. There is no way to create a
  // grootboekrekening in this product — no API operation and no screen — so
  // telling somebody to make one first is sending them after a button that does
  // not exist. What is actionable is choosing a file that fits, and the reader is
  // told the other way round is a later step rather than a refusal on principle.
  await expect(page.getByText(/Kies een bestand dat bij dit grootboek past/)).toBeVisible()
  await expect(page.getByText(/dat komt later/)).toBeVisible()
  await expect(page.getByText(/[Mm]aak ze eerst aan/)).toHaveCount(0)
  await expect(page.getByText(/rekeningen aanmaken/i)).toHaveCount(0)
})
