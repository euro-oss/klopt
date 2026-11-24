import { expect, type Page } from '@playwright/test'
import { e2eInteractionTimeout } from '../support.js'
import { waitImportWizardHydrated } from './import-wizard-hydration.js'

export async function clickImportWizardNextImmediate(page: Page): Promise<void> {
  await waitImportWizardHydrated(page)
  const next = page.locator('button[data-focus="next"]')
  await expect(next).toBeEnabled({ timeout: e2eInteractionTimeout() })
  await next.click()
}

/** Footer shows `wizardVolgendePending.nextSaving` (Opslaan… + aria-busy). */
export async function expectImportWizardFooterOpslaan(page: Page): Promise<void> {
  const next = page.locator('button[data-focus="next"]')
  await expect(next).toHaveAttribute('aria-busy', 'true')
  await expect(next).toContainText('Opslaan…')
}

export async function expectNoImportWizardConfirm(page: Page): Promise<void> {
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
}
