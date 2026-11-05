import { expect, test, type Locator, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import {
  ADVANCED_MODE_SAVE_FAILED,
  clickAdvancedCheckboxAndPersist,
  DATABASE_URL,
  delayClientScripts,
  ensureConfiguredApiDelay,
  hydrated,
  isAdvancedModeSaveRequest,
  signIn,
  uniqueEmail,
  waitForAdvancedModeSaveResponse,
} from './support'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
})

test.beforeEach(async ({ page }) => {
  await ensureConfiguredApiDelay(page)
})

const IMPORT_WIZARD_ADVANCED = /Boekhouddetails|Accounting details/i

async function signedInOwner(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await signIn(page, uniqueEmail())
  await page.getByRole('link', { name: 'Administratie opzetten' }).click()
  await page.getByLabel('Naam', { exact: true }).fill('Import Hydration BV')
  await page.getByRole('button', { name: 'Administratie aanmaken' }).click()
  await expect(
    page.getByRole('heading', { name: /Goedemorgen|Goedemiddag|Goedenavond/ }),
  ).toBeVisible()
  await hydrated(page)
}

function importWizardAdvancedCheckbox(page: Page): Locator {
  return page.locator('[data-slot="import-wizard"]').getByRole('checkbox', {
    name: IMPORT_WIZARD_ADVANCED,
  })
}

function labAdvancedCheckbox(page: Page): Locator {
  return page.getByTestId('lab-advanced')
}

async function openImportLab(page: Page): Promise<void> {
  await page.goto('/lab/import-findings?source=moneybird&state=open')
  await expect(page.locator('[data-slot="import-findings"]')).toBeVisible({ timeout: 15_000 })
}

async function expectAdvancedSaveFailedToast(page: Page): Promise<void> {
  const toast = page.getByTestId('advanced-mode-save-failed')
  await expect(toast).toBeVisible()
  await expect(toast).toContainText(ADVANCED_MODE_SAVE_FAILED)
  await expect(toast.getByRole('button', { name: 'Sluiten' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(1)
}

test.describe('import wizard Boekhouddetails checkbox', () => {
  test('one click toggles once and persists after reload', async ({ page }) => {
    await signedInOwner(page)
    await page.goto('/importeren')
    await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
    const toggle = importWizardAdvancedCheckbox(page)
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    await clickAdvancedCheckboxAndPersist(page, toggle, true)

    await page.reload()
    await hydrated(page)
    await page.goto('/importeren')
    await expect(importWizardAdvancedCheckbox(page)).toBeChecked()
  })

  test('double-click does not apply two toggles', async ({ page }) => {
    await signedInOwner(page)

    let posts = 0
    await page.route('**/*', async (route) => {
      const request = route.request()
      if (isAdvancedModeSaveRequest(request)) {
        posts += 1
      }
      await route.continue()
    })

    await page.goto('/importeren')
    const toggle = importWizardAdvancedCheckbox(page)
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    const persisted = waitForAdvancedModeSaveResponse(page)
    await toggle.dblclick()
    const response = await persisted
    expect(response.status()).toBe(200)
    await expect(toggle).toBeChecked()
    await expect(toggle).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
    expect(posts).toBe(1)

    await page.reload()
    await hydrated(page)
    await page.goto('/importeren')
    await expect(importWizardAdvancedCheckbox(page)).toBeChecked()
  })

  test('disabled while save POST is in flight, then enabled when save completes', async ({
    page,
  }) => {
    await signedInOwner(page)

    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/*', async (route) => {
      const request = route.request()
      if (isAdvancedModeSaveRequest(request)) {
        await held
      }
      await route.continue()
    })

    await page.goto('/importeren')
    const toggle = importWizardAdvancedCheckbox(page)
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    const persisted = waitForAdvancedModeSaveResponse(page)
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect(toggle).toBeDisabled()
    await expect(toggle).toHaveAttribute('aria-busy', 'true')
    release()
    const response = await persisted
    expect(response.status()).toBe(200)
    await expect(toggle).toBeEnabled({ timeout: 30_000 })
    await expect(toggle).toBeChecked()
    await expect(toggle).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
  })

  test('a failed save reverts the checkbox and shows the toast', async ({ page }) => {
    await signedInOwner(page)

    await page.route('**/*', async (route) => {
      const request = route.request()
      if (isAdvancedModeSaveRequest(request)) {
        await route.fulfill({ status: 500, body: 'save failed' })
        return
      }
      await route.continue()
    })

    await page.goto('/importeren')
    const toggle = importWizardAdvancedCheckbox(page)
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked({ timeout: 30_000 })
    await expectAdvancedSaveFailedToast(page)
  })

  test('delayed client bundle disables the checkbox until hydration', async ({ page }) => {
    await signedInOwner(page)
    await delayClientScripts(page, 1_500)
    await page.goto('/importeren', { waitUntil: 'domcontentloaded' })
    const toggle = importWizardAdvancedCheckbox(page)
    await expect(toggle).toBeDisabled()
    await expect(toggle).not.toBeChecked()
    await expect(toggle).toBeEnabled({ timeout: 30_000 })
    await clickAdvancedCheckboxAndPersist(page, toggle, true)
    await page.reload()
    await hydrated(page)
    await page.goto('/importeren')
    await expect(importWizardAdvancedCheckbox(page)).toBeChecked()
  })
})

test.describe('lab import-findings Geavanceerd checkbox', () => {
  test('one click toggles once and persists after reload', async ({ page }) => {
    await signedInOwner(page)
    await openImportLab(page)
    const toggle = labAdvancedCheckbox(page)
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    await clickAdvancedCheckboxAndPersist(page, toggle, true)

    await page.reload()
    await hydrated(page)
    await openImportLab(page)
    await expect(labAdvancedCheckbox(page)).toBeChecked()
  })

  test('double-click does not apply two toggles', async ({ page }) => {
    await signedInOwner(page)

    let posts = 0
    await page.route('**/*', async (route) => {
      const request = route.request()
      if (isAdvancedModeSaveRequest(request)) {
        posts += 1
      }
      await route.continue()
    })

    await openImportLab(page)
    const toggle = labAdvancedCheckbox(page)
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    const persisted = waitForAdvancedModeSaveResponse(page)
    await toggle.dblclick()
    const response = await persisted
    expect(response.status()).toBe(200)
    await expect(toggle).toBeChecked()
    await expect(toggle).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
    expect(posts).toBe(1)

    await page.reload()
    await hydrated(page)
    await openImportLab(page)
    await expect(labAdvancedCheckbox(page)).toBeChecked()
  })

  test('disabled while save POST is in flight, then enabled when save completes', async ({
    page,
  }) => {
    await signedInOwner(page)

    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/*', async (route) => {
      const request = route.request()
      if (isAdvancedModeSaveRequest(request)) {
        await held
      }
      await route.continue()
    })

    await openImportLab(page)
    const toggle = labAdvancedCheckbox(page)
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    const persisted = waitForAdvancedModeSaveResponse(page)
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect(toggle).toBeDisabled()
    await expect(toggle).toHaveAttribute('aria-busy', 'true')
    release()
    const response = await persisted
    expect(response.status()).toBe(200)
    await expect(toggle).toBeEnabled({ timeout: 30_000 })
    await expect(toggle).toBeChecked()
    await expect(toggle).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 })
  })

  test('a failed save reverts the checkbox and shows the toast', async ({ page }) => {
    await signedInOwner(page)

    await page.route('**/*', async (route) => {
      const request = route.request()
      if (isAdvancedModeSaveRequest(request)) {
        await route.fulfill({ status: 500, body: 'save failed' })
        return
      }
      await route.continue()
    })

    await openImportLab(page)
    const toggle = labAdvancedCheckbox(page)
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked({ timeout: 30_000 })
    await expectAdvancedSaveFailedToast(page)
  })

  test('delayed client bundle disables the checkbox until hydration', async ({ page }) => {
    await signedInOwner(page)
    await delayClientScripts(page, 1_500)
    await page.goto('/lab/import-findings?source=moneybird&state=open', {
      waitUntil: 'domcontentloaded',
    })
    const toggle = labAdvancedCheckbox(page)
    await expect(toggle).toBeDisabled()
    await expect(toggle).not.toBeChecked()
    await expect(toggle).toBeEnabled({ timeout: 30_000 })
    await clickAdvancedCheckboxAndPersist(page, toggle, true)
    await page.reload()
    await hydrated(page)
    await openImportLab(page)
    await expect(labAdvancedCheckbox(page)).toBeChecked()
  })
})
