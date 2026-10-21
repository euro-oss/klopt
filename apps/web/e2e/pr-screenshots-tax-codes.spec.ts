import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeDatabase, createDatabase, runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'

/**
 * Public PNGs for the BTW-codes Beheer screen — list + add dialog.
 *
 * Run with:
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=<n> \
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

async function ready(page: Page, name: string): Promise<void> {
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
  const database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
  const client = (database as unknown as { $client: SqlTag }).$client
  try {
    await client`
      delete from klopt.tax_codes
      where entity_id = ${entity.id}::uuid
        and code in ('VERL9-ONTV', 'VERL9-VOOR', 'ICV9', 'ICV9-VOOR')
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

test('capture BTW-codes list + add dialog PNGs', async ({ browser }) => {
  test.setTimeout(600_000)

  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `btw list ${theme} ${label}`)
      await page.goto('/tax-codes')
      await expect(page.getByRole('heading', { name: 'BTW-codes' })).toBeVisible()
      // Desktop: sidebar kbd hints. Phone: Sheet hides them — wait on the CTA.
      if (label === 'mobile-390') {
        await expect(page.getByRole('button', { name: 'Code toevoegen' })).toBeEnabled()
      } else {
        await hydrated(page)
      }
      await setTheme(page, theme)
      await shoot(page, `list-${theme}-${label}.png`)
      await context.close()
    }
  }

  for (const theme of ['light', 'dark'] as const) {
    for (const [label, size] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: size })
      const page = await context.newPage()
      await ready(page, `btw add ${theme} ${label}`)
      await page.goto('/tax-codes')
      await expect(page.getByRole('button', { name: 'Code toevoegen' })).toBeEnabled()
      await page.getByRole('button', { name: 'Code toevoegen' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await setTheme(page, theme)
      await shoot(page, `add-${theme}-${label}.png`)
      await context.close()
    }
  }
})
