import e2eAsOf from '../server-middleware/e2e-as-of.js'

interface NitroApp {
  readonly h3: { readonly '~middleware': unknown[] }
  readonly hooks: {
    hook(name: 'response', fn: () => void): void
  }
}

/** Runs before SSR so `localTodayIso()` can read request-scoped e2e as-of. */
export default function e2eAsOfFirst(app: NitroApp): void {
  app.h3['~middleware'].unshift(e2eAsOf)
  app.hooks.hook('response', () => {
    if (process.env['KLOPT_E2E_LEGAL_TOGGLE'] !== '1') return
    if (process.env['NODE_ENV'] === 'production') return
    delete process.env['KLOPT_E2E_TODAY_ISO']
  })
}
