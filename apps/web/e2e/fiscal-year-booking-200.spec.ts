import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function ready(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.goto('/setup')
  await page.getByLabel('Naam', { exact: true }).fill('Fiscale Poort BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
}

test('prior-year bill shows book-year message, not VAT date hint', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T10:00:00Z'))
  await ready(page)

  await page.goto('/purchases/new')
  await page.getByLabel('Factuurdatum', { exact: true }).fill('2025-12-15')

  await expect(page.getByText('Boekjaar 2025 is nog niet geopend.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Boekjaar 2025 openen' })).toBeVisible()
  await expect(page.getByText('Kies een andere')).toHaveCount(0)
  await expect(page.getByText('geldt niet op deze datum')).toHaveCount(0)
})

test('opening the year returns to the draft with the date intact', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T10:00:00Z'))
  await ready(page)

  await page.goto('/purchases/new')
  await page.getByLabel('Hun nummer', { exact: true }).fill('DEC-2025-01')
  await page.getByLabel('Factuurdatum', { exact: true }).fill('2025-12-15')

  await page.getByRole('link', { name: 'Boekjaar 2025 openen' }).click()
  await expect(page.getByRole('heading', { name: 'Boekjaren' })).toBeVisible()

  await page.getByRole('checkbox', { name: /Ik wil boekjaar 2025 openen/ }).check()
  await page.getByRole('button', { name: 'Boekjaar 2025 openen' }).click()
  await expect(page.getByText('Boekjaar 2025 staat open')).toBeVisible({ timeout: 30_000 })

  await expect(page).toHaveURL(/\/purchases\/new/)
  await expect(page.getByLabel('Factuurdatum', { exact: true })).toHaveValue('2025-12-15')
  await expect(page.getByLabel('Hun nummer', { exact: true })).toHaveValue('DEC-2025-01')
})

test('prior-year open panel has no year text field', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T10:00:00Z'))
  await ready(page)

  await page.goto('/fiscal-years')
  await page.getByRole('button', { name: 'Vorig boekjaar openen' }).click()
  await expect(page.getByText('Er wordt geen beginbalans aangemaakt')).toBeVisible()
  await expect(page.locator('input[inputmode="numeric"][maxlength="4"]')).toHaveCount(1)
})

test('out-of-range book year is refused on the server', async ({ page }) => {
  await ready(page)
  const response = await page.request.post('/api/v1/fiscal-years', {
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    data: { code: '1925' },
  })
  expect(response.status()).toBe(422)
})
