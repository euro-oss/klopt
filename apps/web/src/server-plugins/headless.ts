import headless from '../server-middleware/headless.js'

/**
 * Put the headless gate in front of everything, including Nitro's own.
 *
 * Registered through `nitro({ handlers })` it was global middleware, which
 * sounds like "runs first" and is not: Nitro `unshift`s its public-asset
 * handler ahead of every configured middleware, unconditionally. So a request
 * for a path in the client manifest was answered before the gate ran — and in
 * the headless image, where those files are absent, that meant an ENOENT and
 * a 500 with a stack trace instead of the refusal (ADR 0042 recorded it as a
 * wart; ADR 0056 fixes it).
 *
 * A plugin runs after the app is built and can reorder `~middleware`, and
 * Nitro clears the composed chain immediately afterwards, so this is the
 * supported way to get in front rather than a reach into a private field that
 * happens to work. There is no configuration order that achieves it.
 *
 * "No web app mounted" is only true if the gate is the first thing a request
 * meets. Anything the framework answers ahead of it is a surface the mode
 * claims not to have.
 */

interface NitroApp {
  readonly h3: { readonly '~middleware': unknown[] }
}

export default function headlessFirst(app: NitroApp): void {
  app.h3['~middleware'].unshift(headless)
}
