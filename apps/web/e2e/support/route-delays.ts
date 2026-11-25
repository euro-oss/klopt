import type { Page } from '@playwright/test'

/** Shared with /api/ delay — when set, only non-GET requests are delayed. */
function nonGetOnlyDelay(): boolean {
  return process.env['KLOPT_E2E_API_DELAY_NON_GET_ONLY'] === '1'
}

function shouldApplyAllUrlDelay(request: { method(): string; url(): string }): boolean {
  const nonGetOnly = nonGetOnlyDelay()
  if (nonGetOnly && request.method() === 'GET') return false
  const pathname = new URL(request.url()).pathname
  if (pathname.startsWith('/sign-in') || pathname.startsWith('/setup')) return false
  // Module/font loads stay fast so the shell can hydrate under QA latency.
  if (/\.(js|css|map|woff2?|ttf|ico|png|svg|webp)$/i.test(pathname)) return false
  return true
}

/** Delay every URL (QA gate for #201). Honors `KLOPT_E2E_API_DELAY_NON_GET_ONLY`. */
export async function installAllUrlDelay(page: Page): Promise<void> {
  const raw = process.env['KLOPT_E2E_ALL_URL_DELAY_MS']
  if (raw === undefined || raw === '') return
  const ms = Number(raw)
  await page.route('**/*', async (route) => {
    if (shouldApplyAllUrlDelay(route.request())) {
      await new Promise((resolve) => setTimeout(resolve, ms))
    }
    await route.continue()
  })
}

/** Delay non-GET (and optionally GET) on app HTTP routes (`KLOPT_E2E_API_DELAY_MS`). */
export async function installApiDelay(page: Page): Promise<void> {
  const raw = process.env['KLOPT_E2E_API_DELAY_MS']
  if (raw === undefined || raw === '') return
  const ms = Number(raw)
  if (!Number.isFinite(ms) || ms <= 0) return
  const nonGetOnly = nonGetOnlyDelay()
  await page.route('**/*', async (route) => {
    const request = route.request()
    if (nonGetOnly && request.method() === 'GET') {
      await route.continue()
      return
    }
    const url = request.url()
    try {
      const pathname = new URL(url).pathname
      if (pathname.startsWith('/sign-in') || pathname.startsWith('/setup')) {
        await route.continue()
        return
      }
      if (/\.(js|css|map|woff2?|ttf|ico|png|svg|webp)$/i.test(pathname)) {
        await route.continue()
        return
      }
      if (!/\/api\/|\/_serverFn\//.test(url)) {
        await route.continue()
        return
      }
    } catch {
      await route.continue()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, ms))
    await route.continue()
  })
}

export async function installE2eRouteDelays(page: Page): Promise<void> {
  await installAllUrlDelay(page)
  await installApiDelay(page)
}
