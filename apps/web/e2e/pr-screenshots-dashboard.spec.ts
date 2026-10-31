import { mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import { chooseOption, DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

type SqlTag = (strings: TemplateStringsArray, ...values: readonly unknown[]) => Promise<unknown>

/**
 * Public PNGs for the dashboard werklijst redesign PR (#61 slice 3).
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_NUMBER=<n> pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-dashboard.spec.ts
 *
 * Writes under docs/pr-screenshots/<n>/ and copies matching prototype frames.
 */

const PR = process.env['PR_NUMBER'] ?? '0'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const PROTO = join(import.meta.dirname, '..', '..', '..', 'prototypes', 'redesign', 'screenshots')
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

const MONTHS_NL = [
  'januari',
  'februari',
  'maart',
  'april',
  'mei',
  'juni',
  'juli',
  'augustus',
  'september',
  'oktober',
  'november',
  'december',
] as const

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 and PR_NUMBER to write screenshots')

async function signInFresh(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
}

/** Empty: boekjaar starts this month so no ended btw period appears on the list. */
async function emptyAdministration(page: Page, name: string): Promise<void> {
  await signInFresh(page)
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await chooseOption(page, 'Begint in', MONTHS_NL[new Date().getMonth()]!)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  const viewport = page.viewportSize()
  if (viewport !== null && viewport.width >= 768) {
    await hydrated(page)
  }
}

async function populatedAdministration(page: Page, name: string): Promise<void> {
  await signInFresh(page)
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()

  // Settings so an invoice can be issued.
  await page.goto('/settings')
  await page.getByLabel('Straat').fill('Keizersgracht')
  await page.getByLabel('Huisnummer').fill('1')
  await page.getByLabel('Postcode').fill('1015 CJ')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('12345678')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL123456789B01')
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()

  // Customer + draft (neutral) and overdue (attention).
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Wachtende Klant N.V.')
  await page.getByLabel('E-mail').fill('inkoop@wachtendeklant.example.nl')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Wachtende Klant N.V.' })).toBeVisible()

  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Omschrijving regel 1').fill('Advieswerk')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Prijs regel 1').fill('250,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page.getByRole('heading', { name: /Factuur Concept/ })).toBeVisible()

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-LATE')
  await page.getByLabel('Naam', { exact: true }).fill('Trage Betaler B.V.')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('99887766')
  await page.getByLabel('E-mail').fill('crediteuren@tragebetaler.example.nl')
  await page.getByLabel('Straat').fill('Coolsingel')
  await page.getByLabel('Huisnr.').fill('42')
  await page.getByLabel('Postcode').fill('3011 AD')
  await page.getByLabel('Plaats').fill('Rotterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Trage Betaler B.V.' })).toBeVisible()

  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Factuurdatum').fill('2026-01-05')
  await page.getByLabel('Omschrijving regel 1').fill('Werk uit januari')
  await page.getByLabel('Prijs regel 1').fill('1210,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('link', { name: 'boeking', exact: true })).toBeVisible()

  // Bank lines (neutral) with a real balance.
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
  await expect(page.getByText(/transacties ingelezen/)).toBeVisible()

  // Inbox receipt (neutral).
  await page.goto('/inbox')
  await expect(page.locator('input[type="file"]')).toBeEnabled()
  await page.setInputFiles('input[type="file"]', {
    name: 'bonnetje.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.7 bonnetje ${crypto.randomUUID()}`, 'utf8'),
  })
  await expect(page.getByText('bonnetje.pdf')).toBeVisible()

  // Expense so the chart has a non-zero bar in a past month.
  await page.goto('/entries/new')
  await expect(page.getByRole('button', { name: 'Boeken', exact: true })).toBeEnabled()
  await page.locator('input[type="date"]').first().fill('2026-05-15')
  await page.getByLabel('Omschrijving', { exact: true }).fill('Kantoorbenodigdheden')
  await page.getByRole('combobox', { name: 'Rekening regel 1' }).pressSequentially('4400')
  await page.keyboard.press('Enter')
  await page.getByLabel('Debet regel 1').fill('350,00')
  await page.getByRole('combobox', { name: 'Rekening regel 2' }).pressSequentially('1100')
  await page.keyboard.press('Enter')
  await page.getByLabel('Credit regel 2').fill('350,00')
  await page.getByRole('button', { name: 'Boeken', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Dit wordt geboekt' })).toBeVisible()
  await page.getByRole('button', { name: 'Definitief boeken', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Dit wordt geboekt' })).toBeHidden()

  // Moneybird blocking + locked quarter/year via the store (no live Moneybird).
  const entityRes = await page.request.get('/api/v1/entity')
  expect(entityRes.ok()).toBeTruthy()
  const entity = (await entityRes.json()) as { id: string }
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const sql = (database as unknown as { $client: SqlTag }).$client
  try {
    const year = String(new Date().getUTCFullYear())
    await sql`
      update klopt.periods
      set status = 'soft_closed', updated_at = now()
      where entity_id = ${entity.id}::uuid
        and sequence in (7, 8, 9)
        and ends_on <= ${`${year}-09-30`}::date
    `

    const prior = String(Number(year) - 1)
    await sql`
      insert into klopt.fiscal_years (id, entity_id, code, starts_on, ends_on, status)
      values (
        ${uuidv7()}::uuid,
        ${entity.id}::uuid,
        ${prior},
        ${`${prior}-01-01`}::date,
        ${`${prior}-12-31`}::date,
        'closed'
      )
      on conflict do nothing
    `

    await sql`
      insert into klopt.moneybird_import_runs (
        id, entity_id, administration_id, state, report, finished_at
      ) values (
        ${uuidv7()}::uuid,
        ${entity.id}::uuid,
        '999999',
        'done',
        ${JSON.stringify({
          dryRun: true,
          problems: [
            { code: 'unmapped_ledger', path: 'ledger.8000', message: 'Geen mapping voor omzet' },
            { code: 'unmapped_ledger', path: 'ledger.4000', message: 'Geen mapping voor kosten' },
          ],
          warnings: [],
        })}::jsonb,
        now()
      )
      on conflict (entity_id) do update set
        state = excluded.state,
        report = excluded.report,
        finished_at = excluded.finished_at,
        last_error = null
    `
  } finally {
    await closeDatabase(database)
  }

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Te doen' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Moneybird-import/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /concept(en)? om te versturen/i })).toBeVisible()
  const viewport = page.viewportSize()
  if (viewport !== null && viewport.width >= 768) {
    await hydrated(page)
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
  await page.screenshot({ path: join(OUT, name), fullPage: false })
}

function copyPrototype(name: string, dest: string): void {
  const candidates = [join(PROTO, name), join('/tmp/prototype-screenshots', name)]
  for (const src of candidates) {
    if (existsSync(src)) {
      copyFileSync(src, join(OUT, dest))
      return
    }
  }
}

test('dashboard empty screenshots — no btw row', async ({ page }) => {
  await emptyAdministration(page, 'Screenshot Leeg BV')

  await expect(page.getByRole('heading', { name: 'Niets te doen' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Btw-aangifte/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Kloppen de boeken?' })).toHaveCount(0)

  await page.setViewportSize({ width: 1440, height: 900 })
  await setTheme(page, 'light')
  await shoot(page, 'empty-light-desktop-1440.png')
  await setTheme(page, 'dark')
  await shoot(page, 'empty-dark-desktop-1440.png')

  await page.setViewportSize({ width: 390, height: 844 })
  await setTheme(page, 'light')
  await shoot(page, 'empty-light-mobile-390.png')
  await setTheme(page, 'dark')
  await shoot(page, 'empty-dark-mobile-390.png')
})

test('dashboard populated screenshots — amounts, attention, blocking, lock', async ({ page }) => {
  await populatedAdministration(page, 'Screenshot Werklijst BV')

  await page.setViewportSize({ width: 1440, height: 900 })
  await setTheme(page, 'light')
  await shoot(page, 'populated-light-desktop-1440.png')
  await setTheme(page, 'dark')
  await shoot(page, 'populated-dark-desktop-1440.png')

  await page.setViewportSize({ width: 390, height: 844 })
  await setTheme(page, 'light')
  await shoot(page, 'populated-light-mobile-390.png')
  await setTheme(page, 'dark')
  await shoot(page, 'populated-dark-mobile-390.png')

  copyPrototype('01-dashboard--desktop-light.png', 'proto-dashboard-desktop-light.png')
  copyPrototype('01-dashboard--desktop-dark.png', 'proto-dashboard-desktop-dark.png')
  copyPrototype('01-dashboard--mobile-light.png', 'proto-dashboard-mobile-light.png')
  copyPrototype('01-dashboard--mobile-dark.png', 'proto-dashboard-mobile-dark.png')
})
