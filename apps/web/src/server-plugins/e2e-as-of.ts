import e2eAsOf from '../server-middleware/e2e-as-of.js'

interface NitroApp {
  readonly h3: { readonly '~middleware': unknown[] }
}

/** Runs before SSR so `localTodayIso()` can read `KLOPT_E2E_TODAY_ISO`. */
export default function e2eAsOfFirst(app: NitroApp): void {
  app.h3['~middleware'].unshift(e2eAsOf)
}
