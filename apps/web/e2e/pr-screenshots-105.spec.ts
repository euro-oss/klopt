import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'
import {
  startNullRateMoneybirdStandIn,
  startPreValidFromMoneybirdStandIn,
  type MoneybirdStandIn,
} from './support/moneybird-stand-in'

/**
 * Public PNGs for #105 — import wizard Phase 1 (#100).
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=105 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-105.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? '105'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

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
  await expect(page.getByLabel('Naam van de administratie')).toBeVisible()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
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

/** Radios stay disabled until client hydration — works on 390 where keycaps hide. */
async function wizardBronReady(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
  await expect(page.getByRole('radio', { name: /Moneybird/ })).toBeEnabled({ timeout: 15_000 })
}

async function connectStandIn(page: Page, standIn: MoneybirdStandIn): Promise<void> {
  await page.goto('/importeren')
  await wizardBronReady(page)
  const moneybird = page.getByRole('radio', { name: /Moneybird/ })
  await moneybird.click()
  await expect(moneybird).toBeChecked()
  await page.getByRole('button', { name: 'Volgende' }).click()
  await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()
  await page.locator('details').filter({ hasText: 'Geavanceerd' }).locator('summary').click()
  await page.getByLabel('API-adres').fill(standIn.baseUrl)
  await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
  await page.getByRole('button', { name: 'Verbinden' }).click()
  await expect(
    page.getByRole('heading', { name: /Welke administratie en welke jaren/ }),
  ).toBeVisible({ timeout: 30_000 })
}

async function mapAllOpenRates(page: Page): Promise<void> {
  const choose = page.getByRole('button', { name: 'Btw-code kiezen' })
  while ((await choose.count()) > 0) {
    await choose.first().click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await sheet.getByRole('radio').first().click()
    await sheet.getByRole('button', { name: 'Opslaan' }).click()
    await expect(sheet).toHaveCount(0)
  }
  const confirm = page.getByRole('button', { name: 'Bevestigen' })
  while ((await confirm.count()) > 0) {
    await confirm.first().click()
  }
  const exclude = page.getByRole('button', { name: /niet overzetten/i })
  while ((await exclude.count()) > 0) {
    await exclude.first().click()
  }
}

const VIEWPORTS = [
  ['desktop-1440', { width: 1440, height: 900 }],
  ['mobile-390', { width: 390, height: 844 }],
] as const

test('capture wizard Bron, Verbinden, Administratie, #99 dead end', async ({ browser }) => {
  test.setTimeout(600_000)
  const standIn = await startNullRateMoneybirdStandIn()
  const notInForce = await startPreValidFromMoneybirdStandIn()
  try {
    for (const theme of ['light', 'dark'] as const) {
      for (const [label, size] of VIEWPORTS) {
        const context = await browser.newContext({ viewport: size })
        const page = await context.newPage()
        await ready(page, `105 bron ${theme} ${label}`)
        await page.goto('/importeren')
        await wizardBronReady(page)
        await setTheme(page, theme)
        await shoot(page, `01-bron-${theme}-${label}.png`)
        await context.close()
      }
    }

    for (const theme of ['light', 'dark'] as const) {
      for (const [label, size] of VIEWPORTS) {
        const context = await browser.newContext({ viewport: size })
        const page = await context.newPage()
        await ready(page, `105 verbinden ${theme} ${label}`)
        await page.goto('/importeren')
        await wizardBronReady(page)
        const moneybird = page.getByRole('radio', { name: /Moneybird/ })
        await moneybird.click()
        await expect(moneybird).toBeChecked()
        await page.getByRole('button', { name: 'Volgende' }).click()
        await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()
        await setTheme(page, theme)
        await shoot(page, `02-verbinden-${theme}-${label}.png`)
        await context.close()
      }
    }

    for (const theme of ['light', 'dark'] as const) {
      for (const [label, size] of VIEWPORTS) {
        const context = await browser.newContext({ viewport: size })
        const page = await context.newPage()
        await ready(page, `105 admin ${theme} ${label}`)
        await connectStandIn(page, standIn)
        await page.getByRole('button', { name: 'Administraties ophalen' }).click()
        await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
        await page.getByText('Voorbeeld BV').click()
        await expect(page.getByRole('checkbox', { name: '2026' })).toBeVisible({
          timeout: 60_000,
        })
        await setTheme(page, theme)
        await shoot(page, `03-administratie-${theme}-${label}.png`)
        await context.close()
      }
    }

    for (const theme of ['light', 'dark'] as const) {
      for (const [label, size] of VIEWPORTS) {
        const context = await browser.newContext({ viewport: size })
        const page = await context.newPage()
        await ready(page, `105 problemen ${theme} ${label}`)
        await connectStandIn(page, notInForce)
        await page.getByRole('button', { name: 'Administraties ophalen' }).click()
        await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
        await page.getByText('Voorbeeld BV').click()
        await expect(page.getByRole('checkbox', { name: '2025' })).toBeVisible({
          timeout: 60_000,
        })
        await page.getByRole('button', { name: 'Volgende' }).click()
        await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
          timeout: 30_000,
        })
        await page.getByRole('button', { name: 'Volgende' }).click()
        await expect(page.getByRole('heading', { name: /Welke btw-code/ })).toBeVisible()
        await mapAllOpenRates(page)
        await expect(page.getByRole('button', { name: 'Volgende' })).toBeEnabled({
          timeout: 30_000,
        })
        await page.getByRole('button', { name: 'Volgende' }).click()
        await expect(page.getByRole('heading', { name: /Waar komen je rekeningen/ })).toBeVisible({
          timeout: 30_000,
        })
        await page.getByRole('button', { name: 'Volgende' }).click()
        await expect(page.getByRole('heading', { name: /Wat we nog moeten oplossen/ })).toBeVisible(
          { timeout: 30_000 },
        )
        await expect(page.getByText(/geldt nog niet/i).first()).toBeVisible()
        await setTheme(page, theme)
        await shoot(page, `07-problemen-${theme}-${label}.png`)
        await context.close()
      }
    }
  } finally {
    await standIn.close()
    await notInForce.close()
  }
})
