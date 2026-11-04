/**
 * Playwright calendar tests send `X-Klopt-E2e-As-Of: YYYY-MM-DD` so loaders
 * and `localTodayIso()` match `page.clock` (see e2e/support/contacts-overdue-fixture-dates.ts).
 * Active only when `KLOPT_E2E_LEGAL_TOGGLE=1` (same gate as legal fixture URLs).
 */

import { enterE2eAsOfFromHeaders, parseE2eAsOfHeader } from '../lib/e2e-as-of-store.js'

export default function e2eAsOfMiddleware(event: {
  req: { headers: { get(name: string): string | null } }
}): void {
  if (process.env['KLOPT_E2E_LEGAL_TOGGLE'] !== '1') return
  if (process.env['NODE_ENV'] === 'production') return
  const raw = event.req.headers.get('x-klopt-e2e-as-of')
  const parsed = parseE2eAsOfHeader(raw)
  enterE2eAsOfFromHeaders(raw)
  // Vite SSR and Nitro middleware live in separate bundles, so AsyncLocalStorage
  // set here is not always visible to route loaders. Mirror the header for the
  // current request only; the Nitro `response` hook clears it (see e2e-as-of plugin).
  if (parsed !== undefined) {
    process.env['KLOPT_E2E_TODAY_ISO'] = parsed
    return
  }
  delete process.env['KLOPT_E2E_TODAY_ISO']
}
