import apiV1Gate from '../server-middleware/api-v1.js'
import headless from '../server-middleware/headless.js'

/**
 * Order the gates that must run before Nitro's own handlers.
 *
 * Headless first — it may refuse non-API traffic entirely. The `/api/v1` gate
 * next, so unknown or wrong-method API calls never reach the HTML renderer
 * (#237). Both are unshifted ahead of Nitro's public-asset handler (ADR 0056).
 */

interface NitroApp {
  readonly h3: { readonly '~middleware': unknown[] }
}

export default function httpGatesFirst(app: NitroApp): void {
  app.h3['~middleware'].unshift(apiV1Gate)
  app.h3['~middleware'].unshift(headless)
}
