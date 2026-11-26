import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, signIn, uniqueEmail } from './support'
import { clickImportWizardNext } from './support/import-wizard-click-next'
import { waitImportWizardHydrated } from './support/import-wizard-hydration'
import { isExactPreviewRequest } from './support/import-wizard-exact-preview-route'
import { startExactStandIn, type ExactStandIn } from './support/exact-stand-in'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

function trackUnhandled(page: Page): { assertClean: () => void } {
  const problems: string[] = []
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  return {
    assertClean: () => {
      const unhandled = problems.filter(
        (line) =>
          /unhandled/i.test(line) || /rejection/i.test(line) || line.startsWith('pageerror:'),
      )
      expect(unhandled, problems.join('\n')).toEqual([])
    },
  }
}

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Exact Preview Error BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible({ timeout: 30_000 })
}

async function reachVoorbeeld(page: Page, standIn: ExactStandIn): Promise<void> {
  await page.goto('/importeren')
  await waitImportWizardHydrated(page)
  await page.getByRole('radio', { name: /Exact Online/ }).click()
  await clickImportWizardNext(page, { readyTimeoutMs: 120_000 })

  await expect(page.getByRole('heading', { name: /Verbind met Exact Online/ })).toBeVisible()
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

  await expect(
    page.getByRole('heading', { name: /Welke administratie en welk boekjaar/ }),
  ).toBeVisible({ timeout: 120_000 })

  await page.getByRole('button', { name: /Administraties ophalen|Opnieuw ophalen/ }).click()
  await expect(page.getByRole('button', { name: /Voorbeeld BV/ })).toBeVisible({
    timeout: 60_000,
  })
  await page.getByRole('button', { name: /Voorbeeld BV/ }).click()
  await page.getByLabel(/Boekjaar om te importeren/).fill('2026')
  await clickImportWizardNext(page, { readyTimeoutMs: 120_000 })

  await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
    timeout: 120_000,
  })
}

test.describe('Exact preview failure (#236)', () => {
  test.describe.configure({ timeout: 600_000 })

  test('shows inline error, Retry succeeds, Volgende stays gated', async ({ page }) => {
    const tracker = trackUnhandled(page)
    const standIn = await startExactStandIn()
    try {
      await anAdministration(page)

      let previewHits = 0
      await page.route('**/*', async (route) => {
        const request = route.request()
        if (!isExactPreviewRequest(request)) {
          await route.continue()
          return
        }
        previewHits += 1
        if (previewHits === 1) {
          await route.fulfill({ status: 500, body: 'preview failed' })
          return
        }
        await route.continue()
      })

      await reachVoorbeeld(page, standIn)

      const error = page.getByTestId('exact-preview-load-failed')
      await expect(error).toBeVisible({ timeout: 60_000 })
      await expect(error.getByRole('alert')).toContainText('Voorbeeld laden mislukt.')
      await expect(page.getByRole('button', { name: 'Opnieuw lezen' })).toHaveCount(0)

      const next = page.locator('button[data-focus="next"]')
      await expect(next).toHaveAttribute('aria-disabled', 'true')

      tracker.assertClean()

      await error.getByRole('button', { name: 'Opnieuw proberen' }).click()
      await expect(error).toHaveCount(0, { timeout: 120_000 })
      await expect(page.getByRole('term').filter({ hasText: 'Btw-codes' })).toBeVisible({
        timeout: 120_000,
      })
      await expect(page.getByRole('button', { name: 'Opnieuw lezen' })).toBeVisible({
        timeout: 30_000,
      })
      await expect(next).not.toHaveAttribute('aria-disabled', 'true', { timeout: 30_000 })

      tracker.assertClean()
      expect(previewHits).toBeGreaterThanOrEqual(2)
    } finally {
      await standIn.close()
    }
  })
})
