import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * ONE Playwright spec for Bank · Match redesign (#129 / #140).
 *
 * Covers: sidebar route, command bar route, empty state, one seeded state,
 * keyboard navigation, no console errors.
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
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
}

async function importDemoStatement(page: Page): Promise<void> {
  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByLabel('Naam', { exact: true }).fill('Demo bankrekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL02ABNA0123456789')).toBeVisible()
  await expect(page.locator('input[type="file"]')).toBeEnabled()
  await page.setInputFiles('input[type="file"]', join(FIXTURES, 'statement.mt940'))
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await page.getByRole('button', { name: 'Importeren', exact: true }).click()
  await expect(page.getByText('4 transacties geïmporteerd.')).toBeVisible()
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

  // --- Empty state via sidebar ---
  await page.getByRole('link', { name: /^Bank/ }).click()
  await expect(page).toHaveURL(/\/bank\/match/)
  await expect(page.getByRole('heading', { name: 'Bank' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Bankonderdelen' })).toBeVisible()
  await expect(page.getByText('Alle regels zijn geboekt')).toBeVisible()
  await expect(page.getByText('Het banksaldo en de boeken kloppen weer.')).toBeVisible()
  // Legal: no live-connection / PSD2 / gekoppeld claims on this screen.
  await expect(page.getByText(/gekoppeld/i)).toHaveCount(0)
  await expect(page.getByText(/PSD2/i)).toHaveCount(0)
  await expect(page.getByText(/live connection/i)).toHaveCount(0)

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

  // --- Seeded state ---
  await importDemoStatement(page)
  await page.getByRole('link', { name: /^Bank/ }).click()
  await hydrated(page)
  await expect(page.locator('[data-slot="match-queue"] [data-row]')).toHaveCount(4)
  await expect(page.getByRole('heading', { name: 'Wat was dit?' })).toBeVisible()
  await expect(page.locator('[data-slot="match-choice"]')).toHaveCount(4)
  await expect(page.getByText(/Demo bankrekening/)).toBeVisible()

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
