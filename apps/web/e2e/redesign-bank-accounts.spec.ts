import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

/**
 * Redesign BankAccounts (#129 / #140): sidebar + ⌘K route, empty + seeded,
 * keyboard, no console errors, and Legal copy (no PSD2 / gekoppeld / any Dutch bank).
 *
 * Sample user Eva; example IBAN NL91ABNA0417164300 only for the primary account.
 * PM #171: per-account import, IBAN single-line height at 1440 and 390.
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

const EXAMPLE_IBAN = 'NL91ABNA0417164300'
const SECOND_IBAN = 'NL20INGB0001234567'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function openBankAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Bank Accounts Demo BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
}

function attachConsoleGuard(page: Page): { errors: string[] } {
  const errors: string[] = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.includes('Download the React DevTools')) return
    if (text.includes('third-party cookie')) return
    errors.push(text)
  })
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  return { errors }
}

async function assertNoForbiddenCopy(page: Page): Promise<void> {
  await expect(page.getByText(/PSD2/i)).toHaveCount(0)
  await expect(page.getByText(/gekoppeld/i)).toHaveCount(0)
  await expect(page.getByText(/live connection/i)).toHaveCount(0)
  await expect(page.getByText(/any Dutch bank/i)).toHaveCount(0)
  await expect(page.getByText(/iedere Nederlandse bank/i)).toHaveCount(0)
  await expect(page.getByText(/elke Nederlandse bank/i)).toHaveCount(0)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page
    .context()
    .addCookies([{ name: 'klopt_theme', value: theme, domain: 'localhost', path: '/' }])
  await page.evaluate((t) => {
    document.cookie = `klopt_theme=${t}; path=/; max-age=31536000; samesite=lax`
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForFunction(
    (wantDark) => document.documentElement.classList.contains('dark') === wantDark,
    theme === 'dark',
  )
}

/** Design #171: IBAN is one line; badge must not overlap its box. */
async function assertIbanSingleLine(page: Page): Promise<void> {
  const iban = page.locator('[data-slot="bank-account-iban"]').first()
  const badge = page.locator('[data-slot="bank-account-badge"]').first()
  await expect(iban).toBeVisible()
  await expect(badge).toBeVisible()
  const metrics = await iban.evaluate((el) => {
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return { height: rect.height, lineHeight: Number.parseFloat(style.lineHeight) }
  })
  expect(metrics.lineHeight).toBeGreaterThan(0)
  expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight * 1.2)

  const ibanBox = await iban.boundingBox()
  const badgeBox = await badge.boundingBox()
  expect(ibanBox).not.toBeNull()
  expect(badgeBox).not.toBeNull()
  const overlap =
    ibanBox!.x < badgeBox!.x + badgeBox!.width &&
    ibanBox!.x + ibanBox!.width > badgeBox!.x &&
    ibanBox!.y < badgeBox!.y + badgeBox!.height &&
    ibanBox!.y + ibanBox!.height > badgeBox!.y
  expect(overlap).toBe(false)
}

async function seedAccountAndStatement(page: Page): Promise<void> {
  await page.goto('/bank')
  await hydrated(page)
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill(EXAMPLE_IBAN)
  await page.getByLabel('Naam', { exact: true }).fill('Demo bankrekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL91 ABNA 0417 1643 00')).toBeVisible()

  await expect(page.locator('[data-slot="drop-zone"] input[type="file"]')).toBeEnabled()
  await page.setInputFiles(
    '[data-slot="drop-zone"] input[type="file"]',
    join(FIXTURES, 'statement.mt940'),
  )
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await page.getByRole('button', { name: 'Importeren', exact: true }).click()
  await expect(page.getByText(/transacties geïmporteerd/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Transacties' })).toBeVisible()
}

test('Bank accounts opens from the sidebar and from the command bar', async ({ page }) => {
  const { errors } = attachConsoleGuard(page)
  await openBankAdmin(page)

  await page
    .getByRole('navigation', { name: 'Hoofdnavigatie' })
    .getByRole('link', { name: /^Bank\b/ })
    .click()
  // Sidebar Bank opens /bank/match (#107). Accounts live at /bank — Reach them
  // via BankTabs (Rekeningen) after #164.
  await expect(page).toHaveURL(/\/bank\/match/)
  await page
    .getByRole('navigation', { name: 'Bankonderdelen' })
    .getByRole('link', { name: 'Rekeningen' })
    .click()
  await expect(page).toHaveURL(/\/bank\/?$/)
  await expect(page.getByRole('heading', { name: 'Bank' })).toBeVisible()
  await expect(
    page.getByText('Nog geen bankrekening. Voeg er een toe om afschriften te kunnen importeren.'),
  ).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Bankonderdelen' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Rekeningen' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Batches' })).toBeVisible()
  await assertNoForbiddenCopy(page)

  await page.goto('/')
  await hydrated(page)
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Commando’s' })
  await expect(palette).toBeVisible()
  await page.getByLabel('Zoek een scherm of een boeking').fill('Bankafschriften')
  await expect(palette.getByRole('option', { name: /Bankafschriften/ }).first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/bank\/?$/)
  await expect(page.getByRole('heading', { name: 'Bank' })).toBeVisible()
  await assertNoForbiddenCopy(page)

  expect(errors, errors.join('\n')).toEqual([])
})

test('empty state, seeded account + transactions, keyboard, and Legal copy', async ({ page }) => {
  const { errors } = attachConsoleGuard(page)
  await openBankAdmin(page)

  await page.goto('/bank')
  await hydrated(page)
  await expect(
    page.getByText('Nog geen bankrekening. Voeg er een toe om afschriften te kunnen importeren.'),
  ).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Bankonderdelen' })).toBeVisible()
  await assertNoForbiddenCopy(page)

  await seedAccountAndStatement(page)
  await expect(page.getByText('Demo bankrekening')).toBeVisible()
  await expect(page.getByText('Bestandsimport')).toBeVisible()
  await expect(page.getByText('Bankafschrift importeren').first()).toBeVisible()
  await expect(page.getByText(/CAMT\.053 of MT940 van je bank/)).toBeVisible()
  await expect(page.getByText(/Regels die je al hebt slaat Klopt over/)).toBeVisible()
  await expect(page.getByText('Waar je bank het bestand bewaart')).toHaveCount(0)
  await expect(page.getByText('Grote Klant N.V.')).toBeVisible()
  await expect(page.getByText('te boeken').first()).toBeVisible()
  await assertNoForbiddenCopy(page)

  // Segmented filter + U opens the file picker path (DropZone stays enabled).
  await page.getByRole('tab', { name: /Te boeken/ }).click()
  await expect(page.getByRole('tab', { name: /Te boeken/ })).toHaveAttribute('data-state', 'active')
  await page.getByRole('tab', { name: /Alles/ }).click()

  await page.keyboard.press('u')
  await expect(page.locator('[data-slot="drop-zone"] input[type="file"]').first()).toBeEnabled()

  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  const save = page.getByRole('button', { name: 'Opslaan' })
  await expect(save).toBeVisible()
  await page.getByRole('button', { name: 'Annuleren' }).click()

  expect(errors, errors.join('\n')).toEqual([])
})

test('IBAN stays a single line at 1440 and 390, light and dark', async ({ page }) => {
  await openBankAdmin(page)
  await seedAccountAndStatement(page)

  for (const theme of ['light', 'dark'] as const) {
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ] as const) {
      await page.setViewportSize(size)
      await page.goto('/bank')
      await setTheme(page, theme)
      // hydrated() waits for the desktop Home kbd; skip it on 390.
      if (size.width >= 1440) await hydrated(page)
      await expect(page.getByText('NL91 ABNA 0417 1643 00')).toBeVisible()
      await assertIbanSingleLine(page)
    }
  }
})

test('statement for the second account imports into that account', async ({ page }) => {
  const { errors } = attachConsoleGuard(page)
  await openBankAdmin(page)

  await page.goto('/bank')
  await hydrated(page)

  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill(EXAMPLE_IBAN)
  await page.getByLabel('Naam', { exact: true }).fill('Eerste rekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL91 ABNA 0417 1643 00')).toBeVisible()

  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill(SECOND_IBAN)
  await page.getByLabel('Naam', { exact: true }).fill('Tweede rekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL20 INGB 0001 2345 67')).toBeVisible()

  const secondCard = page.locator('[data-slot="bank-account-card"]', {
    has: page.getByText('Tweede rekening'),
  })
  await expect(secondCard).toBeVisible()
  const secondDrop = secondCard.locator('[data-slot="drop-zone"] input[type="file"]')
  await expect(secondDrop).toBeEnabled()
  await secondDrop.setInputFiles(join(FIXTURES, 'statement-second.mt940'))

  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  // No English core account_mismatch string.
  await expect(page.getByText(/Statement .+ is for .+, not .+\./)).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Importeren', exact: true }).click()
  await expect(page.getByText(/transacties geïmporteerd/)).toBeVisible()
  await expect(page.getByText('Tweede Klant B.V.')).toBeVisible()
  await expect(page.getByText(/Statement .+ is for .+, not .+\./)).toHaveCount(0)

  expect(errors, errors.join('\n')).toEqual([])
})

test('Legal: page never claims PSD2, gekoppeld, or any Dutch bank', async ({ page }) => {
  await openBankAdmin(page)
  await page.goto('/bank')
  await hydrated(page)
  await assertNoForbiddenCopy(page)

  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill(EXAMPLE_IBAN)
  await page.getByLabel('Naam', { exact: true }).fill('Demo bankrekening')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Bankafschrift importeren').first()).toBeVisible()
  await assertNoForbiddenCopy(page)
})
