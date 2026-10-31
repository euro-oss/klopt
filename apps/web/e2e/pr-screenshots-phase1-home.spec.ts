import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import {
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  signIn,
  uniqueEmail,
} from './support'

type SqlTag = (strings: TemplateStringsArray, ...values: readonly unknown[]) => Promise<unknown>

/**
 * Public PNGs for #107 / #112 Phase 1 Home — Main / PhoneHome / HomeDark.
 *
 * 01 = tip smoke; 02 = seeded data (named user + multi-bucket ageing); 03 = empty
 * queue ("Niets te doen", no btw). 1440 / 390, light / dark; 390 full-page too.
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

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

function isoDaysAgo(days: number): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - days)
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function signInFresh(page: Page): Promise<string> {
  const email = uniqueEmail()
  await page.goto('/sign-in')
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  return email
}

async function setDisplayName(email: string, name: string): Promise<void> {
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const sql = (database as unknown as { $client: SqlTag }).$client
  try {
    await sql`update klopt.users set name = ${name} where email = ${email}`
  } finally {
    await closeDatabase(database)
  }
}

async function emptyAdministration(
  page: Page,
  name: string,
  opts?: { displayName?: string },
): Promise<void> {
  const email = await signInFresh(page)
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  // Start in the current month so no closed VAT period is waiting (Design #112).
  await chooseOption(page, 'Begint in', MONTHS_NL[new Date().getMonth()]!)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  // Named empty shot so 390 frames differ from the tip smoke (sidebar is hidden).
  if (opts?.displayName !== undefined) {
    await setDisplayName(email, opts.displayName)
    await page.context().clearCookies()
    await page.goto('/sign-in')
    await signIn(page, email)
    await expect(
      page.getByRole('heading', { name: new RegExp(opts.displayName.split(' ')[0]!) }),
    ).toBeVisible()
  }
}

async function populatedAdministration(page: Page): Promise<void> {
  const email = await signInFresh(page)
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Noordkust Advies B.V.')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()

  // Session embeds the name at sign-in — update the row, then re-auth.
  await setDisplayName(email, 'Hidde Jansen')
  await page.context().clearCookies()
  await page.goto('/sign-in')
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: /Hidde/ })).toBeVisible()

  await page.goto('/settings')
  await page.getByLabel('Straat').fill('Keizersgracht')
  await page.getByLabel('Huisnummer').fill('12')
  await page.getByLabel('Postcode').fill('1015 CN')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('34123456')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL001234567B01')
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()

  await enableAdvancedMode(page)

  // Draft customer + draft invoice (neutral to-do).
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Bakkerij De Korenaar')
  await page.getByLabel('E-mail').fill('facturen@korenaar.example.nl')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Bakkerij De Korenaar' })).toBeVisible()

  await page.goto('/invoices/new')
  await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
  await page.getByLabel('Omschrijving regel 1').fill('Advieswerk')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Prijs regel 1').fill('250,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page.getByRole('heading', { name: /Factuur Concept/ })).toBeVisible()

  // Four overdue invoices across ageing buckets (30-day terms → invoice = due+30).
  // days overdue ≈ 15 / 45 / 75 / 120.
  const overdueSeeds = [
    { number: 'DEB-15', name: 'Atelier Van Dijk', daysOverdue: 15, price: '480,00' },
    { number: 'DEB-45', name: 'Installatiebedrijf Meijer', daysOverdue: 45, price: '1210,00' },
    { number: 'DEB-75', name: 'Hoveniersbedrijf De Linden', daysOverdue: 75, price: '875,00' },
    { number: 'DEB-120', name: 'Drukkerij Westland', daysOverdue: 120, price: '640,00' },
  ] as const

  for (const seed of overdueSeeds) {
    await page.goto('/contacts')
    await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
    await page.getByLabel('Nummer', { exact: true }).fill(seed.number)
    await page.getByLabel('Naam', { exact: true }).fill(seed.name)
    await page.getByLabel('E-mail').fill(`${seed.number.toLowerCase()}@voorbeeld.nl`)
    await page.getByLabel('Straat').fill('Voorstraat')
    await page.getByLabel('Huisnr.').fill('1')
    await page.getByLabel('Postcode').fill('2311 AB')
    await page.getByLabel('Plaats').fill('Leiden')
    await page.getByRole('button', { name: 'Opslaan' }).click()
    await expect(page.getByRole('cell', { name: seed.name })).toBeVisible()

    const invoiceDate = isoDaysAgo(seed.daysOverdue + 30)
    await page.goto('/invoices/new')
    await expect(page.getByRole('button', { name: 'Concept opslaan' })).toBeEnabled()
    await page.getByRole('combobox', { name: 'Klant' }).click()
    await page.getByRole('option', { name: new RegExp(`^${seed.number}`) }).click()
    await expect(page.getByRole('listbox')).toBeHidden()
    await page.getByLabel('Factuurdatum').fill(invoiceDate)
    await page.getByLabel('Omschrijving regel 1').fill(`Werk voor ${seed.name}`)
    await page.getByLabel('Prijs regel 1').fill(seed.price)
    await page.getByRole('button', { name: 'Concept opslaan' }).click()
    await page.getByRole('button', { name: 'Versturen en boeken' }).click()
    await expect(page.getByRole('link', { name: 'boeking', exact: true })).toBeVisible()
  }

  // Open supplier bill (payables tile).
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('CRE-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Kantoorhandel De Vos')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('checkbox', { name: /Leverancier/ }).check()
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Kantoorhandel De Vos' })).toBeVisible()

  await page.goto('/purchases/new')
  await expect(page.getByRole('button', { name: 'Btw berekenen voor regel 1' })).toBeEnabled()
  await page.getByLabel('Factuurnummer leverancier').fill('KV-2026-118')
  await page.getByLabel('Factuurdatum').fill(isoDaysAgo(20))
  await page.getByLabel('Vervaldatum').fill(isoDaysAgo(-10))
  await page.getByLabel('Bedrag excl. btw', { exact: true }).fill('200,00')
  await page.getByLabel('Btw', { exact: true }).fill('42,00')
  await page.getByLabel('Totaal', { exact: true }).fill('242,00')
  await page.getByLabel('Omschrijving regel 1').fill('Kantoorbenodigdheden')
  await chooseOption(page, 'Grootboek regel 1', /^4400 /)
  await chooseOption(page, 'Btw-code regel 1', /^VH21 /)
  await page.getByLabel('Excl. btw regel 1').fill('200,00')
  await page.getByRole('button', { name: 'Btw berekenen voor regel 1' }).click()
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await expect(page.getByRole('heading', { name: /Inkoopfactuur KV-2026-118/ })).toBeVisible()
  await page.getByRole('button', { name: 'Boeken', exact: true }).click()
  await expect(page.getByRole('link', { name: /^boeking \d/ })).toBeVisible()

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
  await expect(page.getByRole('heading', { name: /Hidde/ })).toBeVisible()
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
  fullPage = false,
): Promise<void> {
  await page.setViewportSize(size)
  await page.waitForTimeout(200)
  await page.screenshot({
    path: join(OUT, name),
    fullPage,
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

test('02 Phase 1 Home seeded data — named user, multi-bucket ageing', async ({ page }) => {
  test.setTimeout(180_000)
  await populatedAdministration(page)
  await expect(page.getByRole('heading', { name: /Hidde/ })).toBeVisible()
  await expect(page.getByText('1–30 dagen')).toBeVisible()
  await expect(page.getByText('31–60 dagen')).toBeVisible()
  await expect(page.getByText('61–90 dagen')).toBeVisible()
  await expect(page.getByText('Meer dan 90 dagen')).toBeVisible()

  for (const theme of ['light', 'dark'] as const) {
    await gotoThemed(page, '/', theme)
    await expect(page.getByRole('heading', { name: /Hidde/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Te doen', exact: true })).toBeVisible()
    await shoot(page, `02-home-data-${theme}-desktop-1440.png`, { width: 1440, height: 1040 })
    await shoot(page, `02-home-data-${theme}-mobile-390.png`, { width: 390, height: 844 })
    await shoot(
      page,
      `02-home-data-${theme}-mobile-390-full.png`,
      { width: 390, height: 844 },
      true,
    )
  }
})

test('03 Phase 1 Home empty — Niets te doen, no btw', async ({ page }) => {
  test.setTimeout(120_000)
  await emptyAdministration(page, 'Noordzee Holding B.V.', { displayName: 'Mieke de Boer' })
  await expect(page.getByRole('heading', { name: /Mieke/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Niets te doen', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Btw-aangifte/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Te doen', exact: true })).toHaveCount(0)

  for (const theme of ['light', 'dark'] as const) {
    await gotoThemed(page, '/', theme)
    await expect(page.getByRole('heading', { name: /Mieke/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Niets te doen', exact: true })).toBeVisible()
    await shoot(page, `03-home-empty-${theme}-desktop-1440.png`, { width: 1440, height: 1040 })
    await shoot(page, `03-home-empty-${theme}-mobile-390.png`, { width: 390, height: 844 })
    await shoot(
      page,
      `03-home-empty-${theme}-mobile-390-full.png`,
      { width: 390, height: 844 },
      true,
    )
  }
})
