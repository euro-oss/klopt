import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import { findEntityIdByName, setPeriodStatus } from '@klopt/db/testing'
import {
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  signIn,
  uniqueEmail,
} from './support'

/**
 * Public PNGs for the bank matching redesign PR (#61 slice 6).
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_NUMBER=<n> pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-bank-match.spec.ts
 *
 * Writes under docs/pr-screenshots/<n>/ and copies matching prototype frames
 * from the temporary checkout used at capture time (or /tmp/proto-shots).
 */

const PR = process.env['PR_NUMBER'] ?? '0'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const PROTO =
  process.env['PROTO_SHOTS'] ??
  join(import.meta.dirname, '..', '..', '..', 'prototypes', 'redesign', 'screenshots')
const PROTO_FALLBACK = '/tmp/proto-shots'
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'
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
const MARCH = 3

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 and PR_NUMBER to write screenshots')

async function ready(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

async function importStatement(page: Page): Promise<void> {
  await page.goto('/bank')
  await page.getByRole('button', { name: 'Rekening toevoegen' }).click()
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByLabel('Naam', { exact: true }).fill('ING Zakelijk')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('NL02ABNA0123456789')).toBeVisible()
  await expect(page.locator('input[type="file"]')).toBeEnabled()
  await page.setInputFiles('input[type="file"]', join(FIXTURES, 'statement.mt940'))
  await expect(page.getByRole('heading', { name: 'Wat dit bestand zou doen' })).toBeVisible()
  await page.getByRole('button', { name: 'Inlezen', exact: true }).click()
  await expect(page.getByText('4 transacties ingelezen.')).toBeVisible()
}

async function issueMatchingInvoice(page: Page, withIban = false): Promise<void> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Grote Klant N.V.')
  if (withIban) {
    await page.getByLabel('IBAN').fill('NL91RABO0315273637')
  }
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
}

async function openMatch(page: Page): Promise<void> {
  await page.goto('/bank/match')
  await expect(page.getByRole('heading', { name: 'Koppelen' })).toBeVisible()
  await expect(page.locator('[data-slot="scroll-table"] tbody tr').first()).toBeVisible({
    timeout: 15_000,
  })
  await hydrated(page).catch(async () => {
    await page.waitForTimeout(300)
  })
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

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForFunction(
    (wantDark) => document.documentElement.classList.contains('dark') === wantDark,
    theme === 'dark',
  )
  await page.waitForTimeout(250)
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, name), fullPage: true })
}

function copyProto(name: string, dest: string): void {
  const fromProto = join(PROTO, name)
  const fromFallback = join(PROTO_FALLBACK, name)
  const src = existsSync(fromProto) ? fromProto : fromFallback
  if (existsSync(src)) copyFileSync(src, join(OUT, dest))
}

async function ensurePanelVisible(page: Page): Promise<void> {
  const size = page.viewportSize()
  if (size !== null && size.width < 1024) {
    const skip = page.getByRole('button', { name: 'Overslaan' })
    if (!(await skip.isVisible().catch(() => false))) {
      await page.keyboard.press('Enter')
      await expect(skip).toBeVisible({ timeout: 8_000 })
    }
  }
}

async function selectPaymentRow(page: Page, openPhonePanel = true): Promise<void> {
  const payment = page.locator('[data-slot="scroll-table"] tbody tr').filter({
    hasText: 'Grote Klant',
  })
  await payment.click()
  // Voorstel column fills once suggestions load (visible even with the Sheet closed).
  await expect(payment.getByText('2026-0001', { exact: true })).toBeVisible({ timeout: 10_000 })
  if (!openPhonePanel) return
  await ensurePanelVisible(page)
  const suggestion = page
    .getByText(/staat in de omschrijving en het bedrag klopt precies/)
    .locator('visible=true')
  await expect(suggestion).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Zeker').locator('visible=true').first()).toBeVisible()
}

async function drainQueue(page: Page): Promise<void> {
  for (;;) {
    if (
      await page
        .getByText('Alles is gekoppeld.')
        .isVisible()
        .catch(() => false)
    ) {
      return
    }
    const rows = page.locator('[data-slot="scroll-table"] tbody tr')
    if ((await rows.count()) === 0) return

    const skip = page.getByRole('button', { name: 'Overslaan' })
    if (!(await skip.isVisible().catch(() => false))) {
      await page.keyboard.press('Enter')
      await expect(skip).toBeVisible({ timeout: 8_000 })
    }
    if (await skip.isDisabled().catch(() => true)) return
    await skip.click()
    await page.waitForTimeout(450)
  }
}

test('capture bank match PNGs (1440/390 × light/dark + locked + prototype)', async ({
  browser,
}) => {
  test.setTimeout(900_000)

  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of [
      ['desktop-1440', { width: 1440, height: 900 }],
      ['mobile-390', { width: 390, height: 844 }],
    ] as const) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      const entityName = `Shot ${theme} ${label}`
      await ready(page, entityName)
      await importStatement(page)
      await issueMatchingInvoice(page, true)
      await enableAdvancedMode(page)
      await openMatch(page)
      await setTheme(page, theme)

      // Queue with confidence badges / voorstel column (Geavanceerd on).
      // Mobile: keep the Sheet closed so the swipe hint stays visible.
      await selectPaymentRow(page, label !== 'mobile-390')
      if (label === 'mobile-390') {
        await page.keyboard.press('Escape').catch(() => undefined)
        await page.waitForTimeout(200)
        await expect(page.getByText(/Veeg de tabel opzij/)).toBeVisible()
      }
      await shoot(page, `queue-${theme}-${label}.png`)

      if (label === 'mobile-390') {
        await page.keyboard.press('Enter')
        await expect(page.getByRole('button', { name: 'Overslaan' })).toBeVisible({
          timeout: 8_000,
        })
        await shoot(page, `panel-${theme}-${label}.png`)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
      }

      // Two candidates: reference 99% + IBAN/amount when the contact has the
      // bank line's IBAN (desktop panel).
      if (label === 'desktop-1440') {
        await selectPaymentRow(page)
        const options = page.locator('[role="option"]')
        if ((await options.count()) >= 2) {
          await shoot(page, `two-candidates-${theme}-${label}.png`)
        }
      }

      // Owner soft-closed notice + Naar Boekjaren.
      await setMarchStatus(entityName, 'soft_closed')
      await openMatch(page)
      await setTheme(page, theme)
      await ensurePanelVisible(page)
      await expect(page.getByText(/voorlopig afgesloten/).locator('visible=true')).toBeVisible()
      await shoot(page, `locked-owner-${theme}-${label}.png`)

      // Soft-closed Boekhouder (blocked, no link) — invite a bookkeeper.
      const keeperContext = await browser.newContext({ viewport: size })
      const keeperPage = await keeperContext.newPage()
      const keeperEmail = uniqueEmail()
      await keeperPage.goto('/sign-in')
      await signIn(keeperPage, keeperEmail)
      await expect(
        keeperPage.getByRole('heading', { name: 'Nog geen administratie' }),
      ).toBeVisible()

      await page.goto('/members')
      const invite = page.locator('form', {
        has: page.getByRole('button', { name: 'Uitnodigen' }),
      })
      await invite.getByLabel('E-mail').fill(keeperEmail)
      await chooseOption(page, 'Rol', 'Boekhouder', invite)
      await page.getByRole('button', { name: 'Uitnodigen' }).click()
      await expect(page.getByText(new RegExp(`${keeperEmail} heeft nu toegang`))).toBeVisible()

      await keeperPage.goto('/bank/match')
      await hydrated(keeperPage).catch(async () => {
        await keeperPage.waitForTimeout(300)
      })
      await setTheme(keeperPage, theme)
      await ensurePanelVisible(keeperPage)
      await expect(
        keeperPage
          .getByText(/Alleen de eigenaar of accountant kan hierin boeken/)
          .locator('visible=true'),
      ).toBeVisible()
      await shoot(keeperPage, `locked-bookkeeper-${theme}-${label}.png`)
      await keeperContext.close()

      await setMarchStatus(entityName, 'open')
      await openMatch(page)
      await setTheme(page, theme)
      await selectPaymentRow(page)
      // Desktop: first Enter focuses the candidate; second books. Phone sheet
      // may already be open from selectPaymentRow — still need the book Enter.
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await expect(
        page.getByText('Gekoppeld: Grote Klant N.V.').locator('visible=true'),
      ).toBeVisible()
      await shoot(page, `matched-${theme}-${label}.png`)

      await drainQueue(page)
      await expect(page.getByText('Alles is gekoppeld.')).toBeVisible({ timeout: 15_000 })
      await shoot(page, `empty-${theme}-${label}.png`)
      await context.close()
    }
  }

  // Prototype side-by-sides (#57).
  copyProto('16-bank-match--desktop-light.png', 'prototype-queue-light-desktop-1440.png')
  copyProto('16-bank-match--desktop-dark.png', 'prototype-queue-dark-desktop-1440.png')
  copyProto('16-bank-match--mobile-light.png', 'prototype-queue-light-mobile-390.png')
  copyProto('16-bank-match--mobile-dark.png', 'prototype-queue-dark-mobile-390.png')
  copyProto(
    '17-bank-panel-two-candidates--desktop-light.png',
    'prototype-two-candidates-light-desktop-1440.png',
  )
  copyProto(
    '17-bank-panel-two-candidates--desktop-dark.png',
    'prototype-two-candidates-dark-desktop-1440.png',
  )
  copyProto('19-bank-matched--desktop-light.png', 'prototype-matched-light-desktop-1440.png')
})
