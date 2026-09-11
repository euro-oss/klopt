import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'

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

  const picker = page.getByLabel('Taal / Language')
  await expect(picker).toBeEnabled()
  await picker.selectOption('en')

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

  await page.getByLabel('Taal / Language').selectOption('en')
  await expect(page.getByRole('link', { name: 'Journal entries' })).toBeVisible()

  const second = await context.newPage()
  await second.goto('/')
  await expect(second.getByRole('link', { name: 'Journal entries' })).toBeVisible()

  await context.close()
})
