import { expect, type Page } from '@playwright/test'
import { e2eInteractionTimeout } from '../support.js'

const IMPORT_WIZARD_ADVANCED =
  /Boekhouddetails|Accounting details|Geavanceerd|Show accounting details/i

/**
 * Import-wizard interactive controls are disabled until `useHydrated()`.
 * Volgende may stay disabled for business rules — never use it as the hydration
 * signal on the source step.
 */
export async function waitImportWizardHydrated(page: Page): Promise<void> {
  const timeout = e2eInteractionTimeout()
  const wizard = page.locator('[data-slot="import-wizard"]')
  const labAdvanced = page.getByTestId('lab-advanced')
  if ((await labAdvanced.count()) > 0) {
    await expect(labAdvanced).toBeEnabled({ timeout })
    return
  }
  const advanced = wizard.getByRole('checkbox', { name: IMPORT_WIZARD_ADVANCED })
  if ((await advanced.count()) > 0) {
    await expect(advanced).toBeEnabled({ timeout })
    return
  }
  const radio = wizard.getByRole('radio').first()
  if ((await radio.count()) > 0) {
    await expect(radio).toBeEnabled({ timeout })
    return
  }
  const stepHeader = wizard.locator('header[data-wizard-step] h2').first()
  if ((await stepHeader.count()) > 0) {
    await expect(stepHeader).toBeVisible({ timeout })
    return
  }
  await expect(wizard).toBeVisible({ timeout })
}
