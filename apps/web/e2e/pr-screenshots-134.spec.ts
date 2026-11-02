import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'
import {
  startNullRateMoneybirdStandIn,
  startPreValidFromMoneybirdStandIn,
  type MoneybirdStandIn,
} from './support/moneybird-stand-in'

/**
 * Public PNGs for the import wizard reskin (#180).
 *
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=180 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-134.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '180'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

const SIZES = [
  { label: 'desktop-1440', width: 1440, height: 1040 },
  { label: 'mobile-390', width: 390, height: 844 },
] as const

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function ready(page: Page, name: string): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.goto('/setup')
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
  }, theme)
  await page.waitForTimeout(100)
}

async function shoot(page: Page, name: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(80)
      await page.screenshot({
        path: join(OUT, `${name}-${theme}-${size.label}.png`),
        fullPage: false,
      })
    }
  }
}

async function mapAllOpenRates(page: Page): Promise<void> {
  for (let i = 0; i < 16; i += 1) {
    const confirm = page.getByRole('button', { name: 'Bevestigen' })
    if ((await confirm.count()) === 0) break
    const before = await confirm.count()
    await confirm.first().click()
    await expect(confirm).toHaveCount(before - 1, { timeout: 30_000 })
  }
  for (let i = 0; i < 16; i += 1) {
    const choose = page.getByRole('button', { name: 'Btw-code kiezen' })
    if ((await choose.count()) > 0) {
      await choose.first().click()
      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      await sheet.getByRole('radio').first().click()
      const save = sheet.getByRole('button', { name: 'Opslaan' })
      await expect(save).toBeEnabled({ timeout: 15_000 })
      await save.click()
      await expect(sheet).toHaveCount(0, { timeout: 60_000 })
      continue
    }
    const exclude = page.getByRole('button', { name: /niet overzetten/i })
    if ((await exclude.count()) > 0) {
      const before = await exclude.count()
      await exclude.first().click()
      await expect(exclude).toHaveCount(before - 1, { timeout: 30_000 })
      continue
    }
    break
  }
}

async function clickNext(page: Page): Promise<void> {
  const next = page.locator('button[data-focus="next"]')
  await expect
    .poll(async () => (await next.getAttribute('aria-disabled')) !== 'true', { timeout: 60_000 })
    .toBe(true)
  await next.click()
}

async function connectStandIn(page: Page, standIn: MoneybirdStandIn): Promise<void> {
  await page.goto('/importeren')
  const moneybird = page.getByRole('radio', { name: /Moneybird/ })
  await expect(moneybird).toBeEnabled({ timeout: 15_000 })
  await moneybird.click()
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()
  await page
    .locator('details')
    .filter({ hasText: /Geavanceerd|Boekhouddetails/ })
    .locator('summary')
    .click()
  await page.getByLabel('API-adres').fill(standIn.baseUrl)
  await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
  await clickNext(page)
  await expect(
    page.getByRole('heading', { name: /Welke administratie en welke jaren/ }),
  ).toBeVisible({ timeout: 30_000 })
}

test('source, XAF and connect', async ({ page }) => {
  test.setTimeout(120_000)
  await ready(page, 'Import Demo BV')
  await page.goto('/importeren')
  await expect(page.getByRole('radio', { name: /Moneybird/ })).toBeEnabled({ timeout: 15_000 })
  await shoot(page, '01-source-empty')

  await page.getByRole('radio', { name: /Een ander pakket/ }).click()
  await expect(page.getByRole('button', { name: 'Auditfile openen' })).toBeVisible()
  await shoot(page, '02-source-xaf')

  await page.getByRole('radio', { name: /Moneybird/ }).click()
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()
  await shoot(page, '03-connect')
})

test('years, preview, running and stopped with nothing booked', async ({ page }) => {
  test.setTimeout(420_000)
  const standIn = await startNullRateMoneybirdStandIn()
  try {
    await ready(page, 'Import Jaren BV')
    await connectStandIn(page, standIn)
    await page.getByRole('button', { name: 'Administraties ophalen' }).click()
    await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
    await page.getByText('Voorbeeld BV').click()
    await expect(page.getByRole('checkbox', { name: '2026' })).toBeVisible({ timeout: 60_000 })
    await shoot(page, '04-years')
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
      timeout: 30_000,
    })
    await shoot(page, '05-preview')
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Welke btw-code/ })).toBeVisible()
    for (let i = 0; i < 16; i += 1) {
      const confirm = page.getByRole('button', { name: 'Bevestigen' })
      if ((await confirm.count()) === 0) break
      const before = await confirm.count()
      await confirm.first().click()
      await expect(confirm).toHaveCount(before - 1, { timeout: 30_000 })
    }
    for (let i = 0; i < 8; i += 1) {
      const choose = page.getByRole('button', { name: 'Btw-code kiezen' })
      if ((await choose.count()) === 0) break
      await choose.first().click()
      const sheet = page.getByRole('dialog')
      await sheet.getByRole('radio').first().click()
      const save = sheet.getByRole('button', { name: 'Opslaan' })
      await expect(save).toBeEnabled({ timeout: 15_000 })
      await save.click()
      await expect(sheet).toHaveCount(0, { timeout: 60_000 })
    }
    await clickNext(page)
    for (let i = 0; i < 12; i += 1) {
      const confirm = page.getByRole('button', { name: 'Bevestigen' })
      if ((await confirm.count()) === 0) break
      const before = await confirm.count()
      await confirm.first().click()
      await expect(confirm).toHaveCount(before - 1, { timeout: 30_000 })
    }
    await clickNext(page)
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Klaar om over te zetten/ })).toBeVisible()
    await clickNext(page)
    const confirmDialog = page.getByRole('alertdialog')
    await confirmDialog.getByRole('button', { name: /Overzetten bevestigen/i }).click()
    await expect(page.getByRole('heading', { name: /Bezig met overzetten/ })).toBeVisible({
      timeout: 60_000,
    })
    await shoot(page, '07-import-running')

    process.env['KLOPT_ENCRYPTION_KEY'] = 'e2e-encryption-key-not-for-production-01234'
    const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
    const { createFilesystemDocumentStore } = await import('@klopt/adapters')
    const { createDatabase, closeDatabase } = await import('@klopt/db')
    const directory = mkdtempSync(join(tmpdir(), 'mb-shot-none-'))
    const db = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
    const rejectingFetch: typeof globalThis.fetch = () =>
      Promise.reject(new Error('forced pre-commit network failure'))
    try {
      const store = createFilesystemDocumentStore({ directory })
      for (let i = 0; i < 8; i += 1) {
        const result = await importMoneybirdAdministration(db, store, rejectingFetch)
        if (result.state === 'idle') break
      }
    } finally {
      await closeDatabase(db)
    }
    await expect(page.getByText(/We hebben niets geboekt/i)).toBeVisible({ timeout: 120_000 })
    await shoot(page, '08-import-stopped-nothing')
  } finally {
    await standIn.close()
  }
})

test('problems with a finding, and a partly booked stop', async ({ page }) => {
  test.setTimeout(420_000)
  const standIn = await startPreValidFromMoneybirdStandIn()
  try {
    await ready(page, 'Import Problemen BV')
    await connectStandIn(page, standIn)
    await page.getByRole('button', { name: 'Administraties ophalen' }).click()
    await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
    await page.getByText('Voorbeeld BV').click()
    await expect(page.getByRole('checkbox', { name: '2025' })).toBeVisible({ timeout: 60_000 })
    await clickNext(page)
    await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
      timeout: 30_000,
    })
    await clickNext(page)
    await mapAllOpenRates(page)
    await clickNext(page)
    await clickNext(page)
    await expect(page.getByText(/geldt nog niet/i).first()).toBeVisible({ timeout: 30_000 })
    await shoot(page, '06-problems')
  } finally {
    await standIn.close()
  }
})

test('partly booked stop', async ({ page }) => {
  test.setTimeout(420_000)
  const partial = await startNullRateMoneybirdStandIn()
  try {
    await ready(page, 'Import Deels BV')
    await connectStandIn(page, partial)
    await page.getByRole('button', { name: 'Administraties ophalen' }).click()
    await page.getByText('Voorbeeld BV').click()
    await expect(page.getByRole('checkbox', { name: '2026' })).toBeVisible({ timeout: 60_000 })
    await clickNext(page)
    await clickNext(page)
    await mapAllOpenRates(page)
    await clickNext(page)
    for (let i = 0; i < 12; i += 1) {
      const confirm = page.getByRole('button', { name: 'Bevestigen' })
      if ((await confirm.count()) === 0) break
      const before = await confirm.count()
      await confirm.first().click()
      await expect(confirm).toHaveCount(before - 1, { timeout: 30_000 })
    }
    await clickNext(page)
    await clickNext(page)
    await clickNext(page)
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /Overzetten bevestigen/i })
      .click()
    await expect(page.getByRole('heading', { name: /Bezig met overzetten/ })).toBeVisible({
      timeout: 60_000,
    })

    process.env['KLOPT_ENCRYPTION_KEY'] = 'e2e-encryption-key-not-for-production-01234'
    const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
    const { createFilesystemDocumentStore } = await import('@klopt/adapters')
    const { createDatabase, closeDatabase, MoneybirdImportRepository } = await import('@klopt/db')
    const directory = mkdtempSync(join(tmpdir(), 'mb-shot-partial-'))
    const db = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
    // eslint-disable-next-line @typescript-eslint/unbound-method -- prototype stub
    const originalFinish = MoneybirdImportRepository.prototype.finish
    let blockedRunning = false
    MoneybirdImportRepository.prototype.finish = async function finishOverride(
      this: InstanceType<typeof MoneybirdImportRepository>,
      request: Parameters<typeof originalFinish>[0],
    ) {
      if (!blockedRunning && request.state === 'running') {
        blockedRunning = true
        throw new Error('report save failed after commit')
      }
      return originalFinish.call(this, request)
    }
    try {
      const store = createFilesystemDocumentStore({ directory })
      for (let i = 0; i < 8; i += 1) {
        const result = await importMoneybirdAdministration(db, store)
        if (result.state === 'idle') break
      }
    } finally {
      MoneybirdImportRepository.prototype.finish = originalFinish
      await closeDatabase(db)
    }
    await expect(page.getByText(/staan al in Klopt/i)).toBeVisible({ timeout: 120_000 })
    await shoot(page, '09-import-stopped-partial')
  } finally {
    await partial.close()
  }
})
