import apiV1Gate from '../server-middleware/api-v1.js'
import headless from '../server-middleware/headless.js'

/**
 * Put the HTTP gates in front of everything, including Nitro's own handlers.
 *
 * Registered through `nitro({ handlers })` middleware is global, which sounds
 * like "runs first" and is not: Nitro `unshift`s its public-asset handler ahead
 * of every configured middleware, unconditionally. So a request for a path in
 * the client manifest was answered before the gate ran — and in the headless
 * image, where those files are absent, that meant an ENOENT and a 500 with a
 * stack trace instead of the refusal (ADR 0042 recorded it as a wart; ADR 0056
 * fixes it).
 *
 * A plugin runs after the app is built and can reorder `~middleware`, and
 * Nitro clears the composed chain immediately afterwards, so this is the
 * supported way to get in front rather than a reach into a private field that
 * happens to work. There is no configuration order that achieves it.
 *
 * Headless runs first — it may refuse non-API traffic entirely ("no web app
 * mounted" is only true if the gate is the first thing a request meets). The
 * `/api/v1` gate is next (#237), so unknown or wrong-method API calls never
 * reach the HTML renderer. Both are unshifted ahead of Nitro's public-asset
 * handler; anything the framework answers ahead of them is a surface the mode
 * claims not to have.
 */

interface NitroApp {
  readonly h3: { readonly '~middleware': unknown[] }
}

export default function httpGatesFirst(app: NitroApp): void {
  app.h3['~middleware'].unshift(apiV1Gate)
  app.h3['~middleware'].unshift(headless)
}
