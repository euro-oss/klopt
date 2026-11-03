import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, enableAdvancedMode, hydrated, signIn, uniqueEmail } from './support'

/**
 * PR screenshots for #195 item 1 — customer open + Vervalt on not-yet-due invoice.
 *
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=195 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-contacts-195.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '195'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'
const SCREENSHOT_SOURCE = 'e2e/pr-screenshots-contacts-195.spec.ts'

function withPngSourceChunk(png: Buffer, source: string): Buffer {
  const data = Buffer.concat([Buffer.from('Source\0', 'latin1'), Buffer.from(source, 'latin1')])
  const type = Buffer.from('tEXt', 'latin1')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])))
  const iend = png.length - 12
  return Buffer.concat([png.subarray(0, iend), len, type, data, crc, png.subarray(iend)])
}

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function openAdmin(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Open Schermafdruk BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await enableAdvancedMode(page)
  await hydrated(page)
}

async function persistThemeCookie(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.context().addCookies([
    { name: 'klopt_theme', value: theme, domain: 'localhost', path: '/' },
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

async function seedEntityForSales(page: Page): Promise<void> {
  await page.goto('/settings')
  await page.getByLabel('Straat').fill('Demoweg')
  await page.getByLabel('Huisnummer').fill('10')
  await page.getByLabel('Postcode').fill('1000 BB')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('textbox', { name: 'KvK-nummer' }).fill('12345678')
  await page.getByRole('textbox', { name: 'Btw-nummer' }).fill('NL123456789B01')
  await page.getByLabel('IBAN').fill('NL91ABNA0417164300')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByText('Opgeslagen.')).toBeVisible()
}

async function seedCustomer(page: Page): Promise<string> {
  await page.goto('/contacts')
  await page.getByRole('button', { name: 'Nieuwe relatie' }).click()
  await page.getByLabel('Nummer', { exact: true }).fill('DEB-1950')
  await page.getByLabel('Naam', { exact: true }).fill('Klif Demo Relaties')
  await page.getByLabel('E-mail').fill('facturen@example.nl')
  await page.getByLabel('Straat').fill('Demoweg')
  await page.getByLabel('Huisnr.').fill('10')
  await page.getByLabel('Postcode').fill('1000 AA')
  await page.getByLabel('Plaats').fill('Amsterdam')
  await page.getByRole('button', { name: 'Opslaan' }).click()
  await expect(page.getByRole('button', { name: /Klif Demo Relaties/ })).toBeVisible()
  const id = new URL(page.url()).searchParams.get('id')
  expect(id).toBeTruthy()
  return id!
}

async function issueInvoice(page: Page): Promise<void> {
  await page.goto('/invoices/new')
  await page.getByRole('combobox', { name: 'Klant' }).click()
  await page.getByRole('option', { name: /Klif Demo Relaties/ }).click()
  await page.getByLabel('Omschrijving regel 1').fill('Advies')
  await page.getByLabel('Aantal regel 1').fill('1')
  await page.getByLabel('Eenheid regel 1').fill('EA')
  await page.getByLabel('Prijs regel 1').fill('250,00')
  await page.getByRole('button', { name: 'Concept opslaan' }).click()
  await page.getByRole('button', { name: 'Versturen en boeken' }).click()
  await expect(page.getByRole('heading', { name: /Factuur \d{4}-/ })).toBeVisible()
}

async function shoot(
  page: Page,
  name: string,
  size: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(size)
  await page.waitForTimeout(200)
  const png = await page.screenshot({ fullPage: false })
  writeFileSync(join(OUT, name), withPngSourceChunk(png, SCREENSHOT_SOURCE))
}

test('01 not-yet-due open invoice — desktop 1440 + phone 390 light/dark', async ({ page }) => {
  await openAdmin(page)
  await seedEntityForSales(page)
  const contactId = await seedCustomer(page)
  await issueInvoice(page)

  for (const theme of ['light', 'dark'] as const) {
    await persistThemeCookie(page, theme)
    await page.goto('/contacts')
    await setTheme(page, theme)
    await page.getByRole('button', { name: /Klif Demo Relaties/ }).click()
    const card = page.getByRole('complementary', { name: 'Relatiekaart' })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.getByText(/Vervalt/i)).toBeVisible()
    await shoot(page, `01-contacts-open-not-due-${theme}-desktop-1440.png`, {
      width: 1440,
      height: 1040,
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/contacts/${contactId}`)
    await setTheme(page, theme)
    await expect(page.getByRole('complementary', { name: 'Relatiekaart' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('complementary', { name: 'Relatiekaart' }).getByText(/Vervalt/i)).toBeVisible()
    await shoot(page, `01-contacts-open-not-due-${theme}-mobile-390.png`, { width: 390, height: 844 })
  }
})
