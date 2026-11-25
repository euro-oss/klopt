import { expect, type Page } from '@playwright/test'
import { e2eInteractionTimeout } from '../support.js'
import { waitImportWizardHydrated } from './import-wizard-hydration.js'

const BTW_HEADING = /Btw-codes uit Exact/

/** Visible step title inside the import wizard (h2 on a step, else the page h1). */
export async function readImportWizardStepHeading(page: Page): Promise<string> {
  const wizard = page.locator('[data-slot="import-wizard"]')
  const stepH2 = wizard.locator('header[data-wizard-step] h2')
  if ((await stepH2.count()) > 0) {
    return ((await stepH2.first().textContent()) ?? '').trim()
  }
  const h1 = wizard.locator('h1')
  return ((await h1.first().textContent()) ?? '').trim()
}

/**
 * Clicks Volgende and waits until the step heading changes or Btw is shown.
 * Fails when the wizard does not advance within `advanceTimeoutMs`.
 */
export async function clickImportWizardNext(
  page: Page,
  options?: { readyTimeoutMs?: number; advanceTimeoutMs?: number },
): Promise<void> {
  const readyTimeoutMs = options?.readyTimeoutMs ?? e2eInteractionTimeout(60_000)
  const advanceTimeoutMs = options?.advanceTimeoutMs ?? e2eInteractionTimeout(30_000)

  await waitImportWizardHydrated(page)

  const wizard = page.locator('[data-slot="import-wizard"]')
  const next = wizard.locator('button[data-focus="next"]')

  await expect
    .poll(
      async () => {
        if (await page.getByRole('heading', { name: BTW_HEADING }).isVisible()) {
          return true
        }
        if ((await next.count()) === 0) return false
        const disabled = await next.getAttribute('aria-disabled')
        const busy = await next.getAttribute('aria-busy')
        return disabled !== 'true' && disabled !== '' && busy !== 'true'
      },
      { timeout: readyTimeoutMs },
    )
    .toBe(true)

  if ((await next.count()) === 0) {
    return
  }

  const headingBefore = await readImportWizardStepHeading(page)
  await next.click()

  await expect
    .poll(
      async () => {
        if (await page.getByRole('heading', { name: BTW_HEADING }).isVisible()) {
          return 'advanced'
        }
        const headingNow = await readImportWizardStepHeading(page)
        if (headingNow !== headingBefore && headingNow !== '') {
          return 'advanced'
        }
        return 'waiting'
      },
      {
        timeout: advanceTimeoutMs,
        message: `Volgende did not advance from step “${headingBefore}” within ${advanceTimeoutMs}ms`,
      },
    )
    .toBe('advanced')

  if ((await next.count()) === 0) {
    return
  }

  await expect
    .poll(async () => (await next.getAttribute('aria-busy')) !== 'true', {
      timeout: advanceTimeoutMs,
    })
    .toBe(true)
}
