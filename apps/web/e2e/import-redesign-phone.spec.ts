import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'
import {
  startPreValidFromMoneybirdStandIn,
  type MoneybirdStandIn,
} from './support/moneybird-stand-in'

/**
 * Import wizard phone layout (#134 QA): 390 light/dark past Source.
 */

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Import Phone BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.classList.toggle('dark', value === 'dark')
  }, theme)
}

async function assertNoOverflow(page: Page, label: string): Promise<void> {
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )
  expect(fits, label).toBe(true)
}

async function clickNext(page: Page): Promise<void> {
  await page.locator('button[data-focus="next"]').click()
}

async function connectStandIn(page: Page, standIn: MoneybirdStandIn): Promise<void> {
  await page.goto('/importeren')
  const moneybird = page.getByRole('radio', { name: /Moneybird/ })
  await expect(moneybird).toBeEnabled({ timeout: 15_000 })
  await moneybird.click()
  await clickNext(page)
  await page
    .locator('details')
    .filter({ hasText: /Geavanceerd|Boekhouddetails/ })
    .locator('summary')
    .click()
  await page.getByLabel('API-adres').fill(standIn.baseUrl)
  await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
}

async function mapAllOpenRates(page: Page): Promise<void> {
  for (let i = 0; i < 16; i += 1) {
    const confirm = page.getByRole('button', { name: 'Bevestigen' })
    if ((await confirm.count()) === 0) break
    await confirm.first().click()
  }
  for (let i = 0; i < 16; i += 1) {
    const exclude = page.getByRole('button', { name: /niet overzetten/i })
    if ((await exclude.count()) === 0) break
    await exclude.first().click()
  }
}

test('390 connect and VAT steps do not overflow in light and dark', async ({ page }) => {
  test.setTimeout(180_000)
  const standIn = await startPreValidFromMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.setViewportSize({ width: 390, height: 844 })
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await connectStandIn(page, standIn)
      await assertNoOverflow(page, `${theme} connect`)
      const token = page.getByLabel('Persoonlijk API-token')
      const footer = page.locator('button[data-focus="next"]')
      await expect(token).toBeVisible()
      await expect(footer).toBeVisible()
      const tokenBox = await token.boundingBox()
      const footerBox = await footer.boundingBox()
      expect(tokenBox).not.toBeNull()
      expect(footerBox).not.toBeNull()
      if (tokenBox !== null && footerBox !== null) {
        expect(tokenBox.y + tokenBox.height).toBeLessThanOrEqual(footerBox.y + 2)
      }

      await clickNext(page)
      await page.getByRole('button', { name: 'Administraties ophalen' }).click()
      await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
      await page.getByText('Voorbeeld BV').click()
      await expect(page.getByRole('checkbox', { name: /2026/ })).toBeVisible({ timeout: 60_000 })
      await clickNext(page)
      await clickNext(page)
      await mapAllOpenRates(page)
      await assertNoOverflow(page, `${theme} btw`)
    }
  } finally {
    await standIn.close()
  }
})

test('a stopped import with nothing booked shows one Opnieuw proberen at 390', async ({ page }) => {
  test.setTimeout(300_000)
  const standIn = await startPreValidFromMoneybirdStandIn()
  try {
    await anAdministration(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await connectStandIn(page, standIn)
    await clickNext(page)
    await page.getByRole('button', { name: 'Administraties ophalen' }).click()
    await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
    await page.getByText('Voorbeeld BV').click()
    await expect(page.getByRole('checkbox', { name: /2024/ })).toBeVisible({ timeout: 60_000 })
    await clickNext(page)
    await clickNext(page)
    await mapAllOpenRates(page)
    await clickNext(page)
    await clickNext(page)
    await clickNext(page)
    await clickNext(page)
    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toBeVisible()
    await confirmDialog.getByRole('button', { name: /Overzetten bevestigen/i }).click()

    process.env['KLOPT_ENCRYPTION_KEY'] = 'e2e-encryption-key-not-for-production-01234'
    const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
    const { createFilesystemDocumentStore } = await import('@klopt/adapters')
    const { createDatabase, closeDatabase } = await import('@klopt/db')
    const directory = mkdtempSync(join(tmpdir(), 'mb-phone-stopped-'))
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

    await expect(page.getByRole('button', { name: 'Opnieuw proberen' })).toBeVisible({
      timeout: 120_000,
    })
    await expect(page.getByRole('button', { name: 'Opnieuw proberen' })).toHaveCount(1)
    await assertNoOverflow(page, 'stopped-nothing')
  } finally {
    await standIn.close()
  }
})
