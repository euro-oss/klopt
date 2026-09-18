import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { chooseOption, DATABASE_URL, signIn, uniqueEmail } from './support'

/**
 * Which language the app speaks (spec 12).
 *
 * The rule: what this person chose, then what their browser asks for if we
 * speak it, then Dutch. The default matters — a Dutch bookkeeping package
 * falling back to English is the wrong way round.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: /Administratie opzetten|Set up an administration/ }).click()
  await page.getByLabel(/Naam van de administratie|Name of the administration/).fill('Taal BV')
  await page.getByRole('button', { name: /Administratie aanmaken|Create administration/ }).click()
}

test('a Dutch browser gets Dutch', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'nl-NL' })
  const page = await context.newPage()

  await page.goto('/sign-in')
  await expect(page.getByRole('button', { name: 'Stuur me een code' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'nl-NL')

  await context.close()
})

test('an English browser gets English, without being asked', async ({ browser }) => {
  // Accept-Language is what the browser already sends, so nothing has to be
  // detected in the page — which is also why this cannot cause a hydration
  // mismatch.
  const context = await browser.newContext({ locale: 'en-GB' })
  const page = await context.newPage()

  await page.goto('/sign-in')
  await expect(page.getByRole('button', { name: 'Send me a code' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB')

  await context.close()
})

test('a language we do not have falls back to Dutch, not English', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'de-DE' })
  const page = await context.newPage()

  await page.goto('/sign-in')
  await expect(page.getByRole('button', { name: 'Stuur me een code' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'nl-NL')

  await context.close()
})

test('choosing a language sticks, and outranks the browser', async ({ browser }) => {
  // A Dutch browser, and somebody who wants English anyway.
  const context = await browser.newContext({ locale: 'nl-NL' })
  const page = await context.newPage()
  await anAdministration(page)

  await expect(page.getByRole('link', { name: 'Journaalposten' })).toBeVisible()

  await expect(page.getByLabel('Taal / Language')).toBeEnabled()
  await chooseOption(page, 'Taal / Language', 'English')

  // The navigation changes without a reload.
  await expect(page.getByRole('link', { name: 'Journal entries' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Trial balance' })).toBeVisible()

  // And it survives a fresh page, because the choice is a cookie rather than
  // something held in the tab.
  await page.reload()
  await expect(page.getByRole('link', { name: 'Journal entries' })).toBeVisible()

  await context.close()
})

test('the choice survives a new tab on the same browser', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'nl-NL' })
  const page = await context.newPage()
  await anAdministration(page)

  await chooseOption(page, 'Taal / Language', 'English')
  await expect(page.getByRole('link', { name: 'Journal entries' })).toBeVisible()

  const second = await context.newPage()
  await second.goto('/')
  await expect(second.getByRole('link', { name: 'Journal entries' })).toBeVisible()

  await context.close()
})

/**
 * The labels the *server* computes, which used to be Dutch whatever the reader
 * asked for (ADR 0045).
 *
 * A screen full of translated chrome with "Activa" and "in geschil" in the
 * middle of it is worse than one that is honestly all Dutch: it reads as a
 * translation somebody abandoned halfway. Every one of these arrives as a code
 * plus a Dutch sentence, and the page now translates the code.
 */
test('a server-computed label follows the reader, not the server', async ({ browser }) => {
  // A Dutch browser, switched to English through the picker — the same path
  // the tests above take, and the one that reaches `signIn`'s Dutch labels.
  const context = await browser.newContext({ locale: 'nl-NL' })
  const page = await context.newPage()
  await anAdministration(page)
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await chooseOption(page, 'Taal / Language', 'English')
  await expect(page.getByRole('link', { name: 'Journal entries' })).toBeVisible()

  await page.goto('/reports/balance-sheet')
  // The section titles come off `getBalanceSheet` as `title: 'Activa'`, with
  // `key: 'assets'` beside them. The page reads the key.
  await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Equity' })).toBeVisible()
  await expect(page.getByText('Activa')).toHaveCount(0)

  await page.goto('/vat')
  // "1e kwartaal 2026" in Dutch, "Q1 2026" in English — a different phrasing
  // rather than a translated word, which is why it is a template and not a
  // formatted number.
  await expect(page.getByRole('link', { name: /^Q[1-4] \d{4}$/ }).first()).toBeVisible()
  await expect(page.getByText(/kwartaal/)).toHaveCount(0)

  await context.close()
})

test('and the same screens stay Dutch for a Dutch reader', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'nl-NL' })
  const page = await context.newPage()
  await anAdministration(page)
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await page.goto('/reports/balance-sheet')
  await expect(page.getByRole('heading', { name: 'Activa' })).toBeVisible()

  await page.goto('/vat')
  await expect(page.getByRole('link', { name: /kwartaal/ }).first()).toBeVisible()

  await context.close()
})

/**
 * The domain's own refusals, which were English whatever the reader asked for
 * (ADR 0046).
 *
 * This is the half of the translation gap that hits the *default* user: the
 * app opens in Dutch, and a Dutch bookkeeper who mistyped an account number
 * used to get "No account 9999." from a screen that is otherwise entirely
 * Dutch.
 */
test('a domain refusal is in the reader’s language, with its numbers intact', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'nl-NL' })
  const page = await context.newPage()
  await anAdministration(page)
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await page.getByRole('link', { name: /Nieuwe journaalpost/ }).click()
  await expect(page.getByRole('button', { name: /Boeken/ }).first()).toBeEnabled()
  await page.getByLabel('Omschrijving', { exact: true }).fill('Verkeerde rekening')

  // 9999 does not exist in the MKB chart, so the domain refuses with
  // `unknown_account.account`, whose detail carries the number.
  await page.getByLabel('Rekening regel 1').fill('9999')
  await page.getByLabel('Debet regel 1').fill('1000,00')
  await page.getByLabel('Rekening regel 2').fill('0500')
  await page.getByLabel('Credit regel 2').fill('1000,00')
  await page.getByRole('button', { name: 'Boeken', exact: true }).click()
  await page.getByRole('button', { name: 'Definitief boeken' }).click()

  await expect(page.getByText('Geen rekening 9999.')).toBeVisible()
  await expect(page.getByText('No account 9999.')).toHaveCount(0)

  // And the same refusal in English, for somebody who asked for English.
  await chooseOption(page, 'Taal / Language', 'English')
  await page.getByRole('link', { name: 'Journal entries' }).click()
  await page.getByRole('link', { name: /New journal entry/ }).click()
  await page.getByLabel('Description', { exact: true }).fill('Wrong account')
  await page.getByLabel('Account line 1').fill('9999')
  await page.getByLabel('Debit line 1').fill('1000,00')
  await page.getByLabel('Account line 2').fill('0500')
  await page.getByLabel('Credit line 2').fill('1000,00')
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await page.getByRole('button', { name: 'Post it', exact: true }).click()

  await expect(page.getByText('No account 9999.')).toBeVisible()

  await context.close()
})
