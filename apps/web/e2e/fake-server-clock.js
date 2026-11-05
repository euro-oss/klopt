/**
 * Playwright webServer preload (via `NODE_OPTIONS=--import=...`).
 *
 * When `KLOPT_E2E_NOW_ISO` is set, pins the dev server's `Date` at process
 * start so SSR and server functions see the same instant as the browser spec.
 * Refuses to run when `NODE_ENV=production` (like `src/lib/local-clock.ts`)
 * and is a no-op when the variable is unset. `@sinonjs/fake-timers` is a
 * devDependency, so it is imported only after those checks pass.
 */
const raw = process.env['KLOPT_E2E_NOW_ISO']
if (process.env['NODE_ENV'] === 'production') {
  if (raw !== undefined && raw !== '') {
    console.warn('[fake-server-clock] ignored: NODE_ENV=production')
  }
} else if (raw !== undefined && raw !== '') {
  const ms = Date.parse(raw)
  if (!Number.isNaN(ms)) {
    const { install } = await import('@sinonjs/fake-timers')
    install({ now: ms, toFake: ['Date'], shouldAdvanceTime: true })
  }
}
