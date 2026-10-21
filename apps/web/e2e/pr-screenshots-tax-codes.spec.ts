import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import {
  chooseOption,
  DATABASE_URL,
  enableAdvancedMode,
  hydrated,
  signIn,
  uniqueEmail,
} from './support'

/**
 * Public PNGs for the Btw-codes Beheer screen — list, add sheet, empty sheet,
 * success notice, in-use column, Geavanceerd, end confirm, ended+restore,
 * bookkeeper forbidden.
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=88 \
 *     pnpm --filter @klopt/web exec playwright test e2e/pr-screenshots-tax-codes.spec.ts
 */

const PR = process.env['PR_SCREENSHOT_NUMBER'] ?? 'tax-codes'
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', PR)
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>
}

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) mkdirSync(OUT, { recursive: true })
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/')

async function ready(page: Page, name: string): Promise<string> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam van de administratie').fill(name)
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()

  const entityRes = await page.request.get('/api/v1/entity')
  expect(entityRes.ok()).toBeTruthy()
  const entity = (await entityRes.json()) as { id: string }
  return entity.id
}

async function dropPair(entityId: string): Promise<void> {
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const client = (database as unknown as { $client: SqlTag }).$client
  try {
    await client`
      delete from klopt.tax_codes
      where entity_id = ${entityId}::uuid
        and code in ('VERL9-ONTV', 'VERL9-VOOR', 'ICV9', 'ICV9-VOOR')
    `
  } finally {
    await closeDatabase(database)
  }
}

async function endCode(entityId: string, code: string, validTo: string): Promise<void> {
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const client = (database as unknown as { $client: SqlTag }).$client
  try {
    await client`
      update klopt.tax_codes
      set valid_to = ${validTo}::date
      where entity_id = ${entityId}::uuid
        and code = ${code}
    `
  } finally {
    await closeDatabase(database)
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

const VIEWPORTS = [
  ['desktop-1440', { width: 1440, height: 900 }],
  ['mobile-390', { width: 390, height: 844 }],
] as const

async function waitReady(page: Page, label: string): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Btw-codes' })).toBeVisible()
  if (label === 'mobile-390') {
    await expect(page.getByRole('button', { name: 'Code toevoegen' })).toBeEnabled()
  } else {
    await hydrated(page)
  }
}

test('capture Btw-codes PNGs for #88', async ({ browser }) => {
  test.setTimeout(900_000)

  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      const entityId = await ready(page, `btw list ${theme} ${label}`)
      await dropPair(entityId)
      await page.goto('/tax-codes')
      await waitReady(page, label)
      await setTheme(page, theme)
      await shoot(page, `list-${theme}-${label}.png`)
      await context.close()
    }
  }

  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      const entityId = await ready(page, `btw add ${theme} ${label}`)
      await dropPair(entityId)
      await page.goto('/tax-codes')
      await waitReady(page, label)
      await page.getByRole('button', { name: 'Code toevoegen' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await setTheme(page, theme)
      await shoot(page, `add-${theme}-${label}.png`)
      await context.close()
    }
  }

  // Empty sheet (all codes present).
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `btw empty ${theme} ${label}`)
      await page.goto('/tax-codes')
      await waitReady(page, label)
      await page.getByRole('button', { name: 'Code toevoegen' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByText(/Alle standaardcodes staan al/)).toBeVisible()
      await setTheme(page, theme)
      await shoot(page, `empty-sheet-${theme}-${label}.png`)
      await context.close()
    }
  }

  // Success notice after adding a pair.
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      const entityId = await ready(page, `btw success ${theme} ${label}`)
      await dropPair(entityId)
      await page.goto('/tax-codes')
      await waitReady(page, label)
      await page.getByRole('button', { name: 'Code toevoegen' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('radio', { name: /9% btw verlegd naar jou/ }).click()
      await dialog.getByRole('button', { name: 'Toevoegen' }).click()
      await expect(dialog).toBeHidden()
      await expect(page.getByText(/is toegevoegd/)).toBeVisible()
      await setTheme(page, theme)
      await shoot(page, `success-${theme}-${label}.png`)
      await context.close()
    }
  }

  // Geavanceerd-on list (rubrieken + category).
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `btw advanced ${theme} ${label}`)
      await enableAdvancedMode(page)
      await page.goto('/tax-codes')
      await waitReady(page, label)
      await expect(page.getByRole('columnheader', { name: 'Aangifte' })).toBeVisible()
      await setTheme(page, theme)
      await shoot(page, `advanced-${theme}-${label}.png`)
      await context.close()
    }
  }

  // End-confirm dialog.
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `btw confirm ${theme} ${label}`)
      await page.goto('/tax-codes')
      await waitReady(page, label)
      const endButton = page.getByRole('button', { name: 'Niet meer gebruiken' }).first()
      await expect(endButton).toBeEnabled()
      // Sticky first column intercepts the action cell on 390.
      await endButton.evaluate((el: HTMLElement) => {
        el.click()
      })
      await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 10_000 })
      await setTheme(page, theme)
      await shoot(page, `end-confirm-${theme}-${label}.png`)
      await context.close()
    }
  }

  // Ended state with Weer gebruiken.
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      const entityId = await ready(page, `btw ended ${theme} ${label}`)
      await endCode(entityId, 'L9', '2026-06-30')
      await page.goto('/tax-codes')
      await waitReady(page, label)
      await expect(page.getByRole('button', { name: 'Weer gebruiken' }).first()).toBeVisible()
      await setTheme(page, theme)
      await shoot(page, `ended-${theme}-${label}.png`)
      await context.close()
    }
  }

  // Bookkeeper forbidden message.
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const ownerCtx = await browser.newContext({ viewport: size })
      const keeperCtx = await browser.newContext({ viewport: size })
      const ownerPage = await ownerCtx.newPage()
      await ready(ownerPage, `btw keeper-owner ${theme} ${label}`)

      const keeperPage = await keeperCtx.newPage()
      const keeperEmail = uniqueEmail()
      await keeperPage.goto('/sign-in')
      await signIn(keeperPage, keeperEmail)
      await expect(
        keeperPage.getByRole('heading', { name: 'Nog geen administratie' }),
      ).toBeVisible()

      await ownerPage.goto('/members')
      const invite = ownerPage.locator('form', {
        has: ownerPage.getByRole('button', { name: 'Uitnodigen' }),
      })
      await invite.getByLabel('E-mail').fill(keeperEmail)
      await chooseOption(ownerPage, 'Rol', 'Boekhouder', invite)
      await ownerPage.getByRole('button', { name: 'Uitnodigen' }).click()
      await expect(ownerPage.getByText(new RegExp(`${keeperEmail} heeft nu toegang`))).toBeVisible()

      await keeperPage.goto('/tax-codes')
      await expect(keeperPage.getByRole('heading', { name: 'Btw-codes' })).toBeVisible()
      await expect(keeperPage.getByRole('alert')).toContainText(
        'Alleen de eigenaar of accountant kan btw-codes beheren.',
      )
      await setTheme(keeperPage, theme)
      await shoot(keeperPage, `bookkeeper-${theme}-${label}.png`)
      await ownerCtx.close()
      await keeperCtx.close()
    }
  }
})
