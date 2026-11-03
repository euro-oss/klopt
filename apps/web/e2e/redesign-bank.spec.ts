import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * ONE Playwright spec for Bank · Match redesign (#129 / #140).
 *
 * Covers: sidebar route, command bar route, empty states (no account vs
 * account with nothing to match), seeded state, keyboard navigation, no
 * console errors.
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
})

async function openAdmin(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
}

test('Bank Match: sidebar and command bar, empty and seeded, keyboard, no console errors', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await openAdmin(page, 'Bank Redesign Demo BV')

  // --- Empty with no bank account: not the "balance and books" state ---
  await page.getByRole('link', { name: /^Bank/ }).click()
  await expect(page).toHaveURL(/\/bank\/match/)
  await expect(page.getByRole('heading', { name: 'Bank' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Bankonderdelen' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Rekeningen' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Batches' })).toBeVisible()
  await expect(
    page.getByRole('paragraph').filter({ hasText: 'Nog geen bankrekening' }),
  ).toBeVisible()
  await expect(
    page.getByText('Voeg een bankrekening toe om afschriften te kunnen importeren.'),
  ).toBeVisible()
  await expect(page.getByText('Het banksaldo en de boeken kloppen weer.')).toHaveCount(0)
  await expect(page.getByText('Alle regels zijn afgeletterd')).toHaveCount(0)
  // Legal: no live-connection / PSD2 / gekoppeld claims on this screen.
  await expect(page.getByText(/gekoppeld/i)).toHaveCount(0)
  await expect(page.getByText(/PSD2/i)).toHaveCount(0)
  await expect(page.getByText(/live connection/i)).toHaveCount(0)
  await expect(page.getByText(/any Dutch bank/i)).toHaveCount(0)
  await expect(page.getByText(/every bank/i)).toHaveCount(0)

  // CoS (#140 / #139): middle phone tab is Receipt (NL label: Bon).
  await page.setViewportSize({ width: 390, height: 844 })
  const phoneNav = page.getByRole('navigation', { name: 'Telefoonnavigatie' })
  await expect(phoneNav).toBeVisible()
  await expect(phoneNav.getByRole('link', { name: 'Bon' })).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })

  // --- Empty with an account and nothing to match: balance/books copy ---
  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByLabel('Naam', { exact: true }).fill('Demo bankrekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL91 ABNA 0417 1643 00')).toBeVisible()
  await page.goto('/bank/match')
  await hydrated(page)
  await expect(page.getByText('Alle regels zijn afgeletterd')).toBeVisible()
  await expect(page.getByText('Het banksaldo en de boeken kloppen weer.')).toBeVisible()

  // --- Command bar route ---
  await page.goto('/')
  await hydrated(page)
  await page.keyboard.press('ControlOrMeta+K')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await palette.getByRole('textbox').fill('Bank')
  await palette.getByRole('option', { name: /^Bank/ }).first().click()
  await expect(page).toHaveURL(/\/bank\/match/)
  await expect(page.getByRole('heading', { name: 'Bank' })).toBeVisible()

  // --- Seeded state (second account+import admin path via import helper) ---
  // Account already exists — import into it.
  await page.goto('/bank')
  await expect(page.locator('input[type="file"]')).toBeEnabled()
  await page.setInputFiles('input[type="file"]', join(FIXTURES, 'statement.mt940'))
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await page.getByRole('button', { name: 'Importeren', exact: true }).click()
  await expect(page.getByText('4 transacties geïmporteerd.')).toBeVisible()
  await page.getByRole('link', { name: /^Bank/ }).click()
  await hydrated(page)
  await expect(page.locator('[data-slot="match-queue"] [data-row]')).toHaveCount(4)
  await expect(page.getByRole('heading', { name: 'Wat was dit?' })).toBeVisible()
  await expect(page.locator('[data-slot="match-choice"]')).toHaveCount(4)
  await expect(page.getByText(/Demo bankrekening/).first()).toBeVisible()
  // Signed amount form: true minus, no space before €.
  await expect(page.getByText('\u2212€\u00a02,15').first()).toBeVisible()

  // --- Keyboard navigation ---
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('4')
  await expect(page.getByRole('combobox', { name: 'Categorie' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-slot="match-queue"] [data-row]').first()).toBeFocused()
  await page.keyboard.press('z')
  await expect(page.getByText(/tegenboeking in het journaal/i)).toBeVisible()

  expect(errors, errors.join('\n')).toEqual([])
})
