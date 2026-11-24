import { expect, test, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, hydrated, signIn, uniqueEmail } from './support'
import { clickImportWizardNext } from './support/import-wizard-click-next'
import { isExactPreviewRequest } from './support/import-wizard-exact-preview-route'
import { isWizardStateSave, routeWizardStateSave } from './support/import-wizard-save-route'
import { startExactStandIn, type ExactStandIn } from './support/exact-stand-in'

const NON_GET_DELAY_MS = 1500
const PREVIEW_READ_DELAY_MS = 2000

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

async function installNonGetDelay(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    if (route.request().method() !== 'GET') {
      await new Promise((resolve) => setTimeout(resolve, NON_GET_DELAY_MS))
    }
    await route.continue()
  })
}

async function anAdministration(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await expect(page.getByRole('heading', { name: 'Nog geen administratie' })).toBeVisible()
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Exact Resume BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible({ timeout: 30_000 })
}

async function openExactWizard(page: Page): Promise<void> {
  await page.goto('/importeren')
  await page.getByRole('radio', { name: /Exact Online/ }).click()
  await clickImportWizardNext(page, { readyTimeoutMs: 120_000 })
}

async function connectExactStandIn(page: Page, standIn: ExactStandIn): Promise<void> {
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
}

async function reachVoorbeeld(page: Page, standIn: ExactStandIn): Promise<void> {
  await openExactWizard(page)
  await connectExactStandIn(page, standIn)
  await page.getByRole('button', { name: /Administraties ophalen|Opnieuw ophalen/ }).click()
  await expect(page.getByRole('button', { name: /Voorbeeld BV/ })).toBeVisible({
    timeout: 60_000,
  })
  await page.getByRole('button', { name: /Voorbeeld BV/ }).click()
  await expect(page.getByText(/Gekozen: Voorbeeld BV/)).toBeVisible()
  await page.getByLabel(/Boekjaar om te importeren/).fill('2026')
  await clickImportWizardNext(page, { readyTimeoutMs: 120_000 })
  await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
    timeout: 120_000,
  })
  const taxTerm = page.getByRole('term').filter({ hasText: 'Btw-codes' })
  if ((await taxTerm.count()) === 0) {
    await page.getByRole('button', { name: /Opnieuw lezen/ }).click()
  }
  await expect(taxTerm).toBeVisible({ timeout: 120_000 })
}

async function resumeDoorgaan(page: Page): Promise<void> {
  await page.goto('/importeren')
  await expect(page.getByRole('heading', { name: /Welkom terug/ })).toBeVisible({
    timeout: 60_000,
  })
  await hydrated(page)
  await page.getByRole('button', { name: /^Doorgaan$/i }).click()
}

test.describe('Exact wizard resume under slow network (#223)', () => {
  test.describe.configure({ timeout: 600_000 })

  test.beforeEach(async ({ page }) => {
    await installNonGetDelay(page)
  })

  test('Doorgaan after reload before btw save: Volgende pending, not silent', async ({ page }) => {
    const standIn = await startExactStandIn()
    try {
      await anAdministration(page)
      await reachVoorbeeld(page, standIn)

      let releaseSave: (() => void) | null = null
      const saveGate = new Promise<void>((resolve) => {
        releaseSave = resolve
      })
      await routeWizardStateSave(page, async (route) => {
        const body = route.request().postData() ?? ''
        if (!body.includes('btw')) {
          await route.continue()
          return
        }
        await saveGate
        await route.continue()
      })

      const next = page.locator('button[data-focus="next"]')
      const saveStarted = page.waitForRequest(
        (req) => isWizardStateSave(req) && (req.postData()?.includes('btw') ?? false),
      )
      await next.click()
      await saveStarted
      await expect(next).toHaveAttribute('aria-busy', 'true')

      await page.reload()
      await resumeDoorgaan(page)

      await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
        timeout: 120_000,
      })

      releaseSave!()

      await expect(next).toBeVisible({ timeout: 120_000 })
      await expect
        .poll(
          async () => {
            const ariaDisabled = await next.getAttribute('aria-disabled')
            const ariaBusy = await next.getAttribute('aria-busy')
            if (ariaBusy === 'true') return 'saving'
            if (ariaDisabled !== 'true' && ariaDisabled !== '') return 'ready'
            const reason = page.locator('#wizard-next-why')
            if ((await reason.count()) > 0) return 'blocked-with-reason'
            return 'blocked-silent'
          },
          { timeout: 120_000 },
        )
        .not.toBe('blocked-silent')
    } finally {
      await standIn.close()
    }
  })

  test('Doorgaan after reload: preview re-read shows Opslaan not needPreview', async ({ page }) => {
    const standIn = await startExactStandIn()
    try {
      let previewDelayHits = 0
      let countResumePreviews = false
      let resumePreviewHits = 0
      await page.route('**/*', async (route) => {
        const req = route.request()
        if (isExactPreviewRequest(req)) {
          previewDelayHits += 1
          if (countResumePreviews) resumePreviewHits += 1
          await new Promise((resolve) => setTimeout(resolve, PREVIEW_READ_DELAY_MS))
        } else if (req.method() !== 'GET') {
          await new Promise((resolve) => setTimeout(resolve, NON_GET_DELAY_MS))
        }
        await route.continue()
      })

      await anAdministration(page)
      await reachVoorbeeld(page, standIn)
      await page.reload()
      countResumePreviews = true
      await resumeDoorgaan(page)

      await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
        timeout: 120_000,
      })

      const wizard = page.locator('[data-slot="import-wizard"]')
      const next = wizard.locator('button[data-focus="next"]')
      await expect
        .poll(
          async () => {
            if ((await page.locator('#wizard-next-why').count()) > 0) {
              const text = await page.locator('#wizard-next-why').textContent()
              if (text?.includes('Lees eerst een voorbeeld')) return 'need-preview-flash'
            }
            if ((await next.count()) === 0) return 'waiting'
            const busy = await next.getAttribute('aria-busy')
            const disabled = await next.getAttribute('aria-disabled')
            if (disabled === 'true' && busy !== 'true') return 'silent-blocked'
            if (busy === 'true') return 'pending'
            if (disabled !== 'true') return 'ready'
            return 'waiting'
          },
          { timeout: PREVIEW_READ_DELAY_MS + 15_000 },
        )
        .toBe('ready')

      expect(
        previewDelayHits,
        'previewExactImport delay handler must run at least once on resume re-read',
      ).toBeGreaterThanOrEqual(1)
      expect(
        resumePreviewHits,
        'Doorgaan resume must trigger exactly one Exact preview request (exact-flow re-read only)',
      ).toBe(1)
    } finally {
      await standIn.close()
    }
  })

  test('Doorgaan after btw save 200: lands on Btw', async ({ page }) => {
    const standIn = await startExactStandIn()
    try {
      await anAdministration(page)
      await reachVoorbeeld(page, standIn)

      const saveDone = page.waitForResponse(
        (res) =>
          isWizardStateSave(res.request()) &&
          res.status() === 200 &&
          (res.request().postData()?.includes('btw') ?? false),
        { timeout: 120_000 },
      )
      await clickImportWizardNext(page, { readyTimeoutMs: 120_000 })
      await saveDone

      await page.reload()
      await resumeDoorgaan(page)

      await expect(page.getByRole('heading', { name: /Btw-codes uit Exact/ })).toBeVisible({
        timeout: 120_000,
      })
    } finally {
      await standIn.close()
    }
  })

  test('500 on btw save rolls back to Voorbeeld with saveFailed toast', async ({ page }) => {
    const standIn = await startExactStandIn()
    try {
      await anAdministration(page)
      await reachVoorbeeld(page, standIn)

      await routeWizardStateSave(page, async (route) => {
        const body = route.request().postData() ?? ''
        if (!body.includes('btw')) {
          await route.continue()
          return
        }
        await route.fulfill({ status: 500, body: 'save failed' })
      })

      const next = page.locator('button[data-focus="next"]')
      await next.click()

      await expect(page.getByRole('heading', { name: /Wat we gaan overzetten/ })).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.getByRole('heading', { name: /Btw-codes uit Exact/ })).toHaveCount(0)
      await expect(page.locator('[data-slot="wizard-toast"]')).toContainText(
        'Opslaan is niet gelukt. Probeer het opnieuw.',
      )
    } finally {
      await standIn.close()
    }
  })
})
