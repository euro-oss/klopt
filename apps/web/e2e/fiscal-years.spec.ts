import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { chooseOption, DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * Boekjaren, in a browser: opening the next one and closing the last one.
 *
 * Both operations have existed since M2 and were reachable only from a terminal
 * (#6). They belong in this suite rather than in a handler test because what was
 * missing was never the domain — `handleCloseYear` has its own tests against a
 * real Postgres — it was a screen. The failure mode is "the screen did not
 * change": a button that posts nothing, a refusal that shows up as a blank
 * panel, an acknowledgement that does not gate anything.
 *
 * The close is deliberately checked the slow way round: the year is closed, and
 * then the screen is asked again and has to say so instead of offering the
 * button a second time.
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
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

/** Something in the winst-en-verliesrekening, so a close has work to do. */
async function anExpense(page: Page, amount: string): Promise<void> {
  await page.goto('/entries/new')
  await expect(page.getByRole('button', { name: 'Boeken', exact: true })).toBeEnabled()

  await page.getByLabel('Omschrijving', { exact: true }).fill('Kantoorbenodigdheden')
  await page.getByRole('combobox', { name: 'Rekening regel 1' }).pressSequentially('4400')
  await page.keyboard.press('Enter')
  await page.getByLabel('Debet regel 1').fill(amount)

  await page.getByRole('combobox', { name: 'Rekening regel 2' }).pressSequentially('1100')
  await page.keyboard.press('Enter')
  await page.getByLabel('Credit regel 2').fill(amount)

  await page.getByRole('button', { name: 'Boeken', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Dit wordt geboekt' })).toBeVisible()
  await page.getByRole('button', { name: 'Definitief boeken', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Dit wordt geboekt' })).toBeHidden()
}

test('the next book year is opened from one field, and turns up in the shell', async ({ page }) => {
  await anAdministration(page, 'Rollend Jaar BV')

  await page.goto('/fiscal-years')
  await expect(page.getByRole('heading', { name: 'Boekjaren' })).toBeVisible()
  await hydrated(page)

  // Setup makes one year. The suggestion is the one after it, and the dates are
  // shown rather than asked for: `POST /fiscal-years` derives them.
  const seeded = new Date().getUTCFullYear()
  const next = String(seeded + 1)

  const label = page.getByLabel('Jaartal')
  await expect(label).toHaveValue(next)
  await expect(page.getByTestId('derived-dates')).toContainText('01-01')

  // Typing a different label moves the dates with it, without a round trip.
  await label.fill(String(seeded + 3))
  await expect(page.getByTestId('derived-dates')).toContainText(String(seeded + 3))
  await label.fill(next)

  await page.getByRole('button', { name: 'Boekjaar openen' }).click()
  await expect(page.getByText(`Boekjaar ${next} staat open`)).toBeVisible()

  // In the table, and — the acceptance criterion that spans two issues — in the
  // year picker every report reads, which is a different component entirely.
  await expect(page.getByRole('cell', { name: next, exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: 'Hoofdnavigatie' }).getByLabel('Boekjaar').click()
  await expect(page.getByRole('option', { name: next, exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toBeHidden()

  // A label that is already a book year is not offered again, rather than being
  // offered and then refused.
  await expect(page.getByRole('button', { name: 'Boekjaar openen' })).toBeDisabled()
  await expect(page.getByText(`Boekjaar ${next} bestaat al.`)).toBeVisible()
})

test('a close shows the entries first, is gated on the acknowledgement, and happens once', async ({
  page,
}) => {
  await anAdministration(page, 'Afsluitende Boeken BV')
  await anExpense(page, '250,00')

  const thisYear = String(new Date().getUTCFullYear())
  const next = String(new Date().getUTCFullYear() + 1)

  await page.goto('/fiscal-years')
  await hydrated(page)

  // The balances have nowhere to land yet: setup made one year. The screen says
  // which date is missing and offers the year, rather than letting the request
  // fail and reporting that.
  await chooseOption(page, 'Boekjaar om af te sluiten', new RegExp(`^${thisYear} `))
  await expect(page.getByText(/geen periode die/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Toon wat er geboekt wordt' })).toBeDisabled()

  await page.getByRole('button', { name: `Boekjaar ${next} openen` }).click()
  await expect(page.getByText(/geen periode die/)).toBeHidden()

  // The result goes to an eigen-vermogenrekening, chosen by typing at the
  // picker. A cost account is not on offer here at all.
  const result = page.getByRole('combobox', { name: 'Resultaatrekening' })
  await result.pressSequentially('0900')
  await page.keyboard.press('Enter')
  await expect(result).toHaveValue('0900')

  await page.getByRole('button', { name: 'Toon wat er geboekt wordt' }).click()

  // Line by line, not a total: the account numbers are what makes this
  // checkable against the proefbalans.
  const plan = page.getByText(`Wat het afsluiten van ${thisYear} boekt`)
  await expect(plan).toBeVisible()
  await expect(page.getByRole('cell', { name: '4400' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '0900' }).first()).toBeVisible()
  await expect(page.getByText('250,00').first()).toBeVisible()

  // Nothing is posted until the acknowledgement is ticked, and it says what it
  // is acknowledging rather than "weet je het zeker".
  const close = page.getByRole('button', { name: 'Boekjaar afsluiten' })
  await expect(close).toBeDisabled()
  await page
    .getByLabel('Boekt twee echte journaalposten; hier zit geen knop om dat terug te draaien.')
    .check()
  await expect(close).toBeEnabled()

  await close.click()
  await expect(page.getByText(`Boekjaar ${thisYear} is afgesloten.`)).toBeVisible()

  // The two entries are in the journal, dated the last day of the year and the
  // first of the next, and they are ordinary entries — which is why there is no
  // reopen button anywhere on that screen.
  await page.goto('/entries')
  await expect(
    page.getByRole('cell', { name: `Resultaatbestemming boekjaar ${thisYear}` }),
  ).toBeVisible()
  await expect(
    page.getByRole('cell', { name: `Beginbalans na afsluiting ${thisYear}` }),
  ).toBeVisible()

  // Asked again, the screen says the year is closed and does not offer the
  // action a second time. That state comes from the API rather than from
  // anything this screen remembers.
  await page.goto('/fiscal-years')
  await hydrated(page)
  await chooseOption(page, 'Boekjaar om af te sluiten', new RegExp(`^${thisYear} `))
  const again = page.getByRole('combobox', { name: 'Resultaatrekening' })
  await again.pressSequentially('0900')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Toon wat er geboekt wordt' }).click()

  await expect(page.getByText(/is already closed/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Toon wat er geboekt wordt' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Boekjaar afsluiten' })).toHaveCount(0)
})

test('a result account the domain refuses is reported in the API’s own words', async ({ page }) => {
  await anAdministration(page, 'Verkeerde Rekening BV')

  const thisYear = String(new Date().getUTCFullYear())

  await page.goto('/fiscal-years')
  await hydrated(page)

  await chooseOption(page, 'Boekjaar om af te sluiten', new RegExp(`^${thisYear} `))
  // Closing without carrying balances forward: the other way past a missing
  // next year, and a checkbox rather than a dialogue — the BTW-aangifte's
  // precedent.
  await page.getByLabel('Afsluiten zonder beginbalans').check()
  await expect(page.getByText('Er wordt geen beginbalans geboekt.')).toBeVisible()

  // A number no account answers to. The picker keeps what was typed rather than
  // silently replacing it, and the refusal comes from the ledger.
  const result = page.getByRole('combobox', { name: 'Resultaatrekening' })
  await result.pressSequentially('9999')
  // Tab commits what was typed, which for an unresolvable number is the number.
  await page.keyboard.press('Tab')
  await expect(result).toHaveValue('9999')

  await page.getByRole('button', { name: 'Toon wat er geboekt wordt' }).click()

  await expect(page.getByRole('alert')).toContainText('9999')
  await expect(page.getByRole('button', { name: 'Boekjaar afsluiten' })).toHaveCount(0)
})
