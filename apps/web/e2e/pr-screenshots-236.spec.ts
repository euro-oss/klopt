import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail, waitSignInHydrated } from './support'
import { clickImportWizardNext } from './support/import-wizard-click-next'
import { waitImportWizardHydrated } from './support/import-wizard-hydration'
import { isExactPreviewRequest } from './support/import-wizard-exact-preview-route'
import { startExactStandIn, type ExactStandIn } from './support/exact-stand-in'

const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'pr-screenshots', '236')
const ARTIFACTS = '/opt/cursor/artifacts'
const CAPTURE = process.env['CAPTURE_PR_SCREENSHOTS'] === '1'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  if (CAPTURE) {
    mkdirSync(OUT, { recursive: true })
    mkdirSync(ARTIFACTS, { recursive: true })
  }
})

test.skip(!CAPTURE, 'Set CAPTURE_PR_SCREENSHOTS=1 to write docs/pr-screenshots/236/')

async function setViewport(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 })
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForTimeout(200)
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, name), fullPage: false, animations: 'disabled' })
  await page.screenshot({ path: join(ARTIFACTS, name), fullPage: false, animations: 'disabled' })
}

async function reachVoorbeeldWithPreviewFail(page: Page, standIn: ExactStandIn): Promise<void> {
  await page.goto('/sign-in')
  await waitSignInHydrated(page)
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Preview Error Design BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible({ timeout: 30_000 })

  await page.route('**/*', async (route) => {
    if (isExactPreviewRequest(route.request())) {
      await route.fulfill({ status: 500, body: 'preview failed' })
      return
    }
    await route.continue()
  })

  await page.goto('/importeren', { waitUntil: 'domcontentloaded' })
  await waitImportWizardHydrated(page)
  const exact = page.getByRole('radio', { name: /Exact Online/ })
  await expect(exact).toBeEnabled({ timeout: 120_000 })
  await exact.click()
  await clickImportWizardNext(page, { readyTimeoutMs: 120_000 })
  await expect(page.getByRole('heading', { name: /Verbind met Exact Online/ })).toBeVisible({
    timeout: 120_000,
  })
  await page
    .locator('details')
    .filter({ hasText: /Geavanceerd|Boekhouddetails/ })
    .locator('summary')
    .click()
  await page.getByLabel('Exact-omgeving').fill(standIn.baseUrl)
  await page.getByLabel('Client ID').fill(standIn.clientId)
  await page.getByLabel('Client secret').fill(standIn.clientSecret)
  await page.getByLabel('Redirect-URI').fill(`${new URL(page.url()).origin}/exact/callback`)
  await clickImportWizardNext(page, { readyTimeoutMs: 120_000 })

  await page.getByRole('button', { name: /Administraties ophalen|Opnieuw ophalen/ }).click()
  await expect(page.getByRole('button', { name: /Voorbeeld BV/ })).toBeVisible({
    timeout: 60_000,
  })
  await page.getByRole('button', { name: /Voorbeeld BV/ }).click()
  await page.getByLabel(/Boekjaar om te importeren/).fill('2026')
  await clickImportWizardNext(page, { readyTimeoutMs: 120_000 })

  await expect(page.getByTestId('exact-preview-load-failed')).toBeVisible({ timeout: 120_000 })
}

test.describe('capture #236 preview error states', () => {
  test.describe.configure({ timeout: 600_000 })

  for (const theme of ['light', 'dark'] as const) {
    for (const [label, width] of [
      ['1440', 1440],
      ['390', 390],
    ] as const) {
      test(`${theme} ${label}`, async ({ page }) => {
        const standIn = await startExactStandIn()
        try {
          await setViewport(page, width)
          await reachVoorbeeldWithPreviewFail(page, standIn)
          await setTheme(page, theme)
          await shoot(page, `exact-preview-error-${label}-${theme}.png`)
        } finally {
          await standIn.close()
        }
      })
    }
  }
})
