import type { Page, Request, Route } from '@playwright/test'

/** TanStack `saveImportWizardState` POST (REST `/api/v1/import-wizard/state` or `/_serverFn/`). */
export function isWizardStateSave(request: Request): boolean {
  if (request.method() !== 'POST') return false
  const url = request.url()
  if (url.includes('/api/v1/import-wizard/state')) return true
  const body = request.postData() ?? ''
  if (!body.includes('idempotencyKey')) return false
  return body.includes('"step"') || body.includes('selectedYears')
}

export async function routeWizardStateSave(
  page: Page,
  handler: (route: Route) => Promise<void>,
): Promise<void> {
  await page.route('**/*', async (route) => {
    if (!isWizardStateSave(route.request())) {
      await route.continue()
      return
    }
    await handler(route)
  })
}

/** Optional per-save delay for flake gates (`KLOPT_E2E_WIZARD_SAVE_DELAY_MS`). */
export async function installWizardStateSaveDelay(page: Page): Promise<void> {
  const delayMs = Number(process.env['KLOPT_E2E_WIZARD_SAVE_DELAY_MS'] ?? 0)
  if (!Number.isFinite(delayMs) || delayMs <= 0) return
  await page.route('**/*', async (route) => {
    if (!isWizardStateSave(route.request())) {
      await route.continue()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    await route.continue()
  })
}
