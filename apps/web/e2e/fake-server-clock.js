/**
 * Playwright webServer preload (via `NODE_OPTIONS=--import=...`).
 *
 * When `KLOPT_E2E_NOW_ISO` is set, pins the dev server's `Date` at process
 * start so SSR and server functions see the same instant as the browser spec.
 * No-op in production and when the variable is unset.
 */
import { install } from '@sinonjs/fake-timers'

const raw = process.env['KLOPT_E2E_NOW_ISO']
if (raw !== undefined && raw !== '') {
  const ms = Date.parse(raw)
  if (!Number.isNaN(ms)) {
    install({ now: ms, toFake: ['Date'], shouldAdvanceTime: true })
  }
}
