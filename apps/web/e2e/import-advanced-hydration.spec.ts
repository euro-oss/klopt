import { expect, test, type Locator, type Page } from '@playwright/test'
import { runMigrations } from '@klopt/db'
import { DATABASE_URL, delayClientScripts, hydrated, signIn, uniqueEmail } from './support'

test.beforeAll(async () => {
  await runMigrations(DATABASE_URL)
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

test.describe('import wizard Boekhouddetails checkbox', () => {
  test('one click toggles once and persists after reload', async ({ page }) => {
    await signedInOwner(page)
    await page.goto('/importeren')
    await expect(page.getByRole('heading', { name: /Waar komen je boeken vandaan/ })).toBeVisible()
    const toggle = importWizardAdvancedCheckbox(page)
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect(toggle).not.toHaveAttribute('aria-busy', 'true')

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
      if (request.method() === 'POST' && (request.postData() ?? '').includes('enabled')) {
        posts += 1
      }
      await route.continue()
    })

    await page.goto('/importeren')
    const toggle = importWizardAdvancedCheckbox(page)
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    await toggle.dblclick()
    await expect(toggle).not.toHaveAttribute('aria-busy', 'true')
    await expect(toggle).toBeChecked()
    expect(posts).toBe(1)

    await page.reload()
    await hydrated(page)
    await page.goto('/importeren')
    await expect(importWizardAdvancedCheckbox(page)).toBeChecked()
  })

  test('delayed client bundle disables the checkbox until hydration', async ({ page }) => {
    await signedInOwner(page)
    await delayClientScripts(page, 1_500)
    await page.goto('/importeren', { waitUntil: 'domcontentloaded' })
    const toggle = importWizardAdvancedCheckbox(page)
    await expect(toggle).toBeDisabled()
    await expect(toggle).not.toBeChecked()
    await expect(toggle).toBeEnabled({ timeout: 30_000 })
    await toggle.click()
    await expect(toggle).toBeChecked()
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
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect(toggle).not.toHaveAttribute('aria-busy', 'true')

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
      if (request.method() === 'POST' && (request.postData() ?? '').includes('enabled')) {
        posts += 1
      }
      await route.continue()
    })

    await openImportLab(page)
    const toggle = labAdvancedCheckbox(page)
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    await toggle.dblclick()
    await expect(toggle).not.toHaveAttribute('aria-busy', 'true')
    await expect(toggle).toBeChecked()
    expect(posts).toBe(1)

    await page.reload()
    await hydrated(page)
    await openImportLab(page)
    await expect(labAdvancedCheckbox(page)).toBeChecked()
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
    await toggle.click()
    await expect(toggle).toBeChecked()
    await page.reload()
    await hydrated(page)
    await openImportLab(page)
    await expect(labAdvancedCheckbox(page)).toBeChecked()
  })
})
