import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for the guided invoice redesign PR (#61 slice 5).
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_NUMBER=<n> pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-guided-invoice.spec.ts
 */

const PR = process.env['PR_NUMBER'] ?? '0'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const PROTO = join(import.meta.dirname, '..', '..', '..', 'prototypes', 'redesign', 'screenshots')
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 and PR_NUMBER to write screenshots')

async function shot(
  page: Page,
  name: string,
  opts: { width: number; height: number; dark?: boolean },
): Promise<void> {
  await page.setViewportSize({ width: opts.width, height: opts.height })
  if (opts.dark) {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
  } else {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const suffix = `${opts.dark ? 'dark' : 'light'}-${opts.width >= 1000 ? 'desktop-1440' : 'mobile-390'}`
  await page.screenshot({
    path: join(OUT, `${name}-${suffix}.png`),
    fullPage: true,
  })
}

function copyProto(name: string, protoBase: string): void {
  for (const theme of ['light', 'dark'] as const) {
    for (const [size, label] of [
      ['desktop', 'desktop-1440'],
      ['mobile', 'mobile-390'],
    ] as const) {
      const src = join(PROTO, `${protoBase}--${size}-${theme}.png`)
      const dest = join(OUT, `prototype-${name}-${theme}-${label}.png`)
      if (existsSync(src)) copyFileSync(src, dest)
    }
  }
}

async function readyAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Screenshot Factuur BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await hydrated(page)

  await page.goto('/settings')
  await page.getByLabel('Straat').fill('Lange Delft')
  await page.getByLabel('Huisnummer').fill('41')
  await page.getByLabel('Postcode').fill('4331 JC')
  await page.getByLabel('Plaats').fill('Middelburg')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('61234567')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL861234567B01')
  await page.getByLabel('IBAN').fill('NL02ABNA0123456789')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()

  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-0001')
  await page.getByLabel('Naam', { exact: true }).fill('Hotel Zeezicht B.V.')
  await page.getByLabel('E-mail').fill('administratie@hotelzeezicht.nl')
  await page.getByLabel('Straat').fill('Boulevard de Ruyter')
  await page.getByLabel('Huisnr.').fill('2')
  await page.getByLabel('Postcode').fill('4381 KA')
  await page.getByLabel('Plaats').fill('Vlissingen')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('cell', { name: 'Hotel Zeezicht B.V.' })).toBeVisible()
}

test('capture guided invoice PNGs', async ({ page }) => {
  copyProto('invoice-1-klant', '11-invoice-1-klant')
  copyProto('invoice-2-wat', '12-invoice-2-wat')
  copyProto('invoice-3-controleren', '13-invoice-3-controleren')
  copyProto('invoice-4-bevestigen', '14-invoice-4-bevestigen')
  copyProto('invoice-verstuurd', '15-invoice-verstuurd')

  // Empty / loading / error under the shell.
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill('Screenshot Empty BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await hydrated(page)

  await page.goto('/lab/guided-invoice?state=empty')
  await expect(page.getByText('Nog geen klanten')).toBeVisible()
  for (const dark of [false, true]) {
    await shot(page, 'empty', { width: 1440, height: 900, dark })
    await shot(page, 'empty', { width: 390, height: 844, dark })
  }

  await page.goto('/lab/guided-invoice?state=loading')
  await expect(page.getByText('Even geduld')).toBeVisible()
  await shot(page, 'loading', { width: 1440, height: 900, dark: false })
  await shot(page, 'loading', { width: 390, height: 844, dark: true })

  await page.goto('/lab/guided-invoice?state=error')
  await expect(page.getByRole('alert')).toBeVisible()
  await shot(page, 'error', { width: 1440, height: 900, dark: false })
  await shot(page, 'error', { width: 390, height: 844, dark: true })

  // Populated flow states.
  await readyAdmin(page)

  await page.goto('/invoices/new')
  await expect(page.getByRole('heading', { name: 'Nieuwe factuur' })).toBeVisible()
  await page.locator('#cust-q').fill('Hotel')
  await expect(page.getByRole('option', { name: /Hotel Zeezicht/ })).toBeVisible()
  for (const dark of [false, true]) {
    await shot(page, 'step1-klant', { width: 1440, height: 900, dark })
    await shot(page, 'step1-klant', { width: 390, height: 844, dark })
  }

  await page.getByRole('button', { name: /Verder/ }).click()
  await expect(page.getByText('Stap 2 van 4')).toBeVisible()
  await page.getByLabel('Omschrijving regel 1').fill('Desembroden, week 41')
  await page.getByLabel('Aantal regel 1').fill('60')
  await page.getByLabel('Prijs regel 1').fill('4,20')
  await page.getByLabel('Omschrijving regel 2').fill('Appeltaarten voor de zondagsbrunch')
  await page.getByLabel('Aantal regel 2').fill('6')
  await page.getByLabel('Prijs regel 2').fill('32,50')
  for (const dark of [false, true]) {
    await shot(page, 'step2-wat', { width: 1440, height: 900, dark })
    await shot(page, 'step2-wat', { width: 390, height: 844, dark })
  }

  await page.getByRole('button', { name: /Verder/ }).click()
  await expect(page.getByText('Stap 3 van 4')).toBeVisible()
  for (const dark of [false, true]) {
    await shot(page, 'step3-controleren', { width: 1440, height: 900, dark })
    await shot(page, 'step3-controleren', { width: 390, height: 844, dark })
  }

  await page.getByRole('button', { name: /Verder/ }).click()
  await expect(page.getByText('Stap 4 van 4')).toBeVisible()
  await page.getByRole('button', { name: /^Versturen/ }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  for (const dark of [false, true]) {
    await shot(page, 'step4-bevestigen', { width: 1440, height: 900, dark })
    await shot(page, 'step4-bevestigen', { width: 390, height: 844, dark })
  }

  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /^Versturen/ })
    .click()
  await expect(page.getByRole('heading', { name: /Verstuurd naar/ })).toBeVisible({
    timeout: 30_000,
  })
  for (const dark of [false, true]) {
    await shot(page, 'verstuurd', { width: 1440, height: 900, dark })
    await shot(page, 'verstuurd', { width: 390, height: 844, dark })
  }
})
