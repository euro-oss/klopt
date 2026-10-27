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
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(100)
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
  await clickNext(page)
  await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()
  await page.locator('details').filter({ hasText: 'Geavanceerd' }).locator('summary').click()
  await page.getByLabel('API-adres').fill(standIn.baseUrl)
  await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
  await clickNext(page)
  await expect(
    page.getByRole('heading', { name: /Welke administratie en welke jaren/ }),
  ).toBeVisible({ timeout: 30_000 })
}

/**
 * Resolve every open rate: confirm suggestions, pick a sheet code, or exclude.
 * Waits until Volgende is no longer aria-disabled.
 */
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
      const radio = sheet.getByRole('radio').first()
      await expect(radio).toBeVisible({ timeout: 15_000 })
      await radio.click()
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

  await expect(page.getByRole('button', { name: 'Btw-code kiezen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Bevestigen' })).toHaveCount(0)
  await expectNextReady(page)
}

/** Volgende uses aria-disabled (not the native disabled attribute). */
async function expectNextReady(page: Page): Promise<void> {
  const next = page.locator('button[data-focus="next"]')
  await expect(next).toBeVisible()
  await expect
    .poll(
      async () => {
        const aria = await next.getAttribute('aria-disabled')
        return aria !== 'true' && aria !== ''
      },
      { timeout: 60_000 },
    )
    .toBe(true)
}

async function clickNext(page: Page): Promise<void> {
  await expectNextReady(page)
  await page.locator('button[data-focus="next"]').click()
}

async function throughAdmin(page: Page, standIn: MoneybirdStandIn): Promise<void> {
  await connectStandIn(page, standIn)
  await page.getByRole('button', { name: 'Administraties ophalen' }).click()
  await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
  await page.getByText('Voorbeeld BV').click()
  await expect(page.getByRole('checkbox', { name: /^202\d$/ }).first()).toBeVisible({
    timeout: 60_000,
  })
}

const VIEWPORTS = [
  ['desktop-1440', { width: 1440, height: 900 }],
  ['mobile-390', { width: 390, height: 844 }],
] as const

test('capture wizard steps 1–10 and key dialogs', async ({ browser }) => {
  test.setTimeout(900_000)
  const standIn = await startNullRateMoneybirdStandIn()
  const notInForce = await startPreValidFromMoneybirdStandIn()
  try {
    for (const theme of ['light', 'dark'] as const) {
      for (const [label, size] of VIEWPORTS) {
        const context = await browser.newContext({ viewport: size })
        const page = await context.newPage()

        // 01 Bron
        await ready(page, `105 full ${theme} ${label}`)
        await page.goto('/importeren')
        await wizardBronReady(page)
        await setTheme(page, theme)
        await shoot(page, `01-bron-${theme}-${label}.png`)

        // Exact dead end
        await page.getByRole('radio', { name: /Exact Online/ }).click()
        await expect(page.getByText(/kan nog niet in deze wizard/i)).toBeVisible()
        await shoot(page, `01-bron-exact-${theme}-${label}.png`)

        // 02 Verbinden
        await page.getByRole('radio', { name: /Moneybird/ }).click()
        await clickNext(page)
        await expect(page.getByRole('heading', { name: /Verbind met Moneybird/ })).toBeVisible()
        await shoot(page, `02-verbinden-${theme}-${label}.png`)

        // Connect via stand-in for remaining steps
        await page.locator('details').filter({ hasText: 'Geavanceerd' }).locator('summary').click()
        await page.getByLabel('API-adres').fill(standIn.baseUrl)
        await page.getByLabel('Persoonlijk API-token').fill(standIn.token)
        await clickNext(page)
        await expect(
          page.getByRole('heading', { name: /Welke administratie en welke jaren/ }),
        ).toBeVisible({ timeout: 30_000 })

        // 03 Administratie
        await page.getByRole('button', { name: 'Administraties ophalen' }).click()
        await expect(page.getByText('Voorbeeld BV')).toBeVisible({ timeout: 30_000 })
        await page.getByText('Voorbeeld BV').click()
        await expect(page.getByRole('checkbox', { name: /^202\d$/ }).first()).toBeVisible({
          timeout: 60_000,
        })
        await shoot(page, `03-administratie-${theme}-${label}.png`)

        await clickNext(page)
        // 04 Voorbeeld
        await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
          timeout: 30_000,
        })
        await shoot(page, `04-voorbeeld-${theme}-${label}.png`)

        await clickNext(page)
        // 05 Btw
        await expect(page.getByRole('heading', { name: /Welke btw-code/ })).toBeVisible()
        await shoot(page, `05-btw-${theme}-${label}.png`)

        // Sheet picker — save from the open sheet (no Escape; that left rates stuck).
        const choose = page.getByRole('button', { name: 'Btw-code kiezen' })
        if ((await choose.count()) > 0) {
          await choose.first().click()
          const sheet = page.getByRole('dialog')
          await expect(sheet).toBeVisible()
          await shoot(page, `05-btw-sheet-${theme}-${label}.png`)
          const radio = sheet.getByRole('radio').first()
          await expect(radio).toBeVisible({ timeout: 15_000 })
          await radio.click()
          const save = sheet.getByRole('button', { name: 'Opslaan' })
          await expect(save).toBeEnabled({ timeout: 15_000 })
          await save.click()
          await expect(sheet).toHaveCount(0, { timeout: 60_000 })
        }

        // 05 with Voorstel / Vorige keuze still visible (before Bevestigen)
        await expect(page.getByRole('heading', { name: /Welke btw-code/ })).toBeVisible()
        await expect(page.getByText(/Voorstel|Vorige keuze/).first()).toBeVisible({
          timeout: 15_000,
        })
        await shoot(page, `05-btw-voorstel-${theme}-${label}.png`)

        await mapAllOpenRates(page)
        await expect(page.getByText(/Kies eerst voor/i)).toHaveCount(0)
        await clickNext(page)
        await expect(page.getByRole('heading', { name: /Welke btw-code/ })).toHaveCount(0)

        // 06 Rekeningen
        await expect(page.getByRole('heading', { name: /Waar komen je rekeningen/ })).toBeVisible({
          timeout: 30_000,
        })
        await shoot(page, `06-rekeningen-${theme}-${label}.png`)
        // Confirm account proposals so Geavanceerd-off path stays name→name
        for (let i = 0; i < 12; i += 1) {
          const confirm = page.getByRole('button', { name: 'Bevestigen' })
          if ((await confirm.count()) === 0) break
          const before = await confirm.count()
          await confirm.first().click()
          await expect(confirm).toHaveCount(before - 1, { timeout: 30_000 })
        }
        await clickNext(page)

        // 07 Problemen
        await expect(
          page.getByRole('heading', { name: /Wat we nog moeten oplossen|Niets houdt/ }),
        ).toBeVisible({ timeout: 30_000 })
        await shoot(page, `07-problemen-${theme}-${label}.png`)

        // Continue when nothing blocks; otherwise #99 path covers the blocked shot
        const why = page.locator('#wizard-next-why')
        if ((await why.count()) === 0) {
          await clickNext(page)
          await expect(page.getByRole('heading', { name: /Klaar om over te zetten/ })).toBeVisible()
          await shoot(page, `08-overzicht-${theme}-${label}.png`)

          await clickNext(page)
          const confirmDialog = page.getByRole('alertdialog')
          await expect(confirmDialog).toBeVisible()
          await shoot(page, `08-overzicht-confirm-${theme}-${label}.png`)
          await confirmDialog.getByRole('button', { name: /Overzetten bevestigen/i }).click()

          // Step 9 must show progress — not Klaar. Hold the worker until after the shot.
          await expect(page.getByRole('heading', { name: /Bezig met overzetten/ })).toBeVisible({
            timeout: 60_000,
          })
          await shoot(page, `09-importeren-${theme}-${label}.png`)

          const { importMoneybirdAdministration } = await import('../../worker/src/moneybird.js')
          const { createFilesystemDocumentStore } = await import('@klopt/adapters')
          const { mkdtempSync } = await import('node:fs')
          const { join: pathJoin, tmpdir } = await import('node:path')
          const { createDatabase, closeDatabase } = await import('@klopt/db')
          const directory = mkdtempSync(pathJoin(tmpdir(), 'mb-shot-'))
          const db = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
          try {
            await importMoneybirdAdministration(db, createFilesystemDocumentStore({ directory }))
          } finally {
            await closeDatabase(db)
          }

          await expect(page.getByRole('heading', { name: /^Import klaar$/ })).toBeVisible({
            timeout: 120_000,
          })
          await shoot(page, `10-klaar-${theme}-${label}.png`)
        }

        await context.close()
      }
    }

    // #99 dead-end problemen (busy)
    for (const theme of ['light', 'dark'] as const) {
      for (const [label, size] of VIEWPORTS) {
        const context = await browser.newContext({ viewport: size })
        const page = await context.newPage()
        await ready(page, `105 nif ${theme} ${label}`)
        await throughAdmin(page, notInForce)
        await expect(page.getByRole('checkbox', { name: '2025' })).toBeVisible({ timeout: 60_000 })
        await setTheme(page, theme)
        await shoot(page, `03-administratie-99-${theme}-${label}.png`)
        await clickNext(page)
        await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
          timeout: 30_000,
        })
        await clickNext(page)
        await expect(page.getByRole('heading', { name: /Welke btw-code/ })).toBeVisible()
        await mapAllOpenRates(page)
        await clickNext(page)
        await expect(page.getByRole('heading', { name: /Waar komen je rekeningen/ })).toBeVisible({
          timeout: 30_000,
        })
        await clickNext(page)
        await expect(page.getByRole('heading', { name: /Wat we nog moeten oplossen/ })).toBeVisible(
          {
            timeout: 30_000,
          },
        )
        await expect(page.getByText(/geldt nog niet/i).first()).toBeVisible()
        await shoot(page, `07-problemen-99-${theme}-${label}.png`)
        await context.close()
      }
    }
  } finally {
    await standIn.close()
    await notInForce.close()
  }
})
