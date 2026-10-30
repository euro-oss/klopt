import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

type SqlTag = (strings: TemplateStringsArray, ...values: readonly unknown[]) => Promise<unknown>

/**
 * Public PNGs for #107 / #112 Phase 1 Home — Main / PhoneHome / HomeDark.
 *
 * 01 = tip empty smoke; 02 = seeded data (real name); 03 = empty queue.
 * 1440 / 390, light / dark.
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=112 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-phase1-home.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '112'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
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

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function signInFresh(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
}

async function emptyAdministration(page: Page, name: string): Promise<void> {
  await signInFresh(page)
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
}

async function populatedAdministration(page: Page, name: string): Promise<void> {
  await signInFresh(page)
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()

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

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Wachtende Klant N.V.')
  await page.getByLabel('E-mail').fill('inkoop@wachtendeklant.nl')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Wachtende Klant N.V.' })).toBeVisible()

  // Bookkeeper invoice form (Eigenaar default is guided until Geavanceerd).
  await enableAdvancedMode(page)
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
  await page.getByLabel('E-mail').fill('crediteuren@tragebetaler.nl')
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

  await page.goto('/inbox')
  await expect(page.locator('input[type="file"]')).toBeEnabled()
  await page.setInputFiles('input[type="file"]', {
    name: 'bonnetje.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.7 bonnetje ${randomUUID()}`, 'utf8'),
  })
  await expect(page.getByText('bonnetje.pdf')).toBeVisible()

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
  await hydrated(page)
}

async function persistThemeCookie(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.context().addCookies([
    {
      name: 'klopt_theme',
      value: theme,
      domain: 'localhost',
      path: '/',
    },
  ])
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await persistThemeCookie(page, theme)
  await page.evaluate((t) => {
    document.cookie = `klopt_theme=${t}; path=/; max-age=31536000; samesite=lax`
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForFunction(
    (wantDark) => document.documentElement.classList.contains('dark') === wantDark,
    theme === 'dark',
  )
  await page.waitForTimeout(250)
}

async function gotoThemed(page: Page, path: string, theme: 'light' | 'dark'): Promise<void> {
  await persistThemeCookie(page, theme)
  await page.goto(path)
  await setTheme(page, theme)
}

async function shoot(
  page: Page,
  name: string,
  size: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(size)
  await page.waitForTimeout(200)
  await page.screenshot({
    path: join(OUT, name),
    fullPage: false,
  })
}

test('01 Phase 1 Home tip — 1440 and 390, light and dark', async ({ page }) => {
  await emptyAdministration(page, 'Phase1 Home BV')
  await expect(page.getByRole('region', { name: 'Kerncijfers' })).toBeVisible()

  for (const theme of ['light', 'dark'] as const) {
    await gotoThemed(page, '/', theme)
    await expect(
      page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
    ).toBeVisible()
    await shoot(page, `01-home-${theme}-desktop-1440.png`, { width: 1440, height: 1040 })
    await shoot(page, `01-home-${theme}-mobile-390.png`, { width: 390, height: 844 })
  }
})

test('02 Phase 1 Home seeded data — real name, 1440 and 390', async ({ page }) => {
  await populatedAdministration(page, 'Studio Noord BV')
  await expect(
    page.getByRole('heading', { name: /Studio Noord|Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()

  for (const theme of ['light', 'dark'] as const) {
    await gotoThemed(page, '/', theme)
    await expect(page.getByRole('heading', { name: 'Te doen' })).toBeVisible()
    await shoot(page, `02-home-data-${theme}-desktop-1440.png`, { width: 1440, height: 1040 })
    await shoot(page, `02-home-data-${theme}-mobile-390.png`, { width: 390, height: 844 })
  }
})

test('03 Phase 1 Home empty — Niets te doen', async ({ page }) => {
  await emptyAdministration(page, 'Lege Boeken BV')
  // Prefer an empty queue when VAT is not waiting; otherwise still shoot Home.
  const empty = page.getByRole('heading', { name: 'Niets te doen' })
  const todo = page.getByRole('heading', { name: 'Te doen' })
  await expect(empty.or(todo)).toBeVisible()

  for (const theme of ['light', 'dark'] as const) {
    await gotoThemed(page, '/', theme)
    await shoot(page, `03-home-empty-${theme}-desktop-1440.png`, { width: 1440, height: 1040 })
    await shoot(page, `03-home-empty-${theme}-mobile-390.png`, { width: 390, height: 844 })
  }
})
