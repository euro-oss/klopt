import { AsyncLocalStorage } from 'node:async_hooks'
import { bindE2eAsOfReader } from './e2e-as-of-request.js'
import { parseE2eAsOfHeader } from './e2e-as-of-header.js'

const storage = new AsyncLocalStorage<string | undefined>()

bindE2eAsOfReader(() => storage.getStore() ?? null)

export { parseE2eAsOfHeader } from './e2e-as-of-header.js'

/** Request-scoped as-of from Playwright (`X-Klopt-E2e-As-Of`). */
export function readE2eAsOfFromRequestScope(): string | null {
  const value = storage.getStore()
  return value ?? null
}

export function runWithE2eAsOf<T>(asOf: string | undefined, fn: () => T): T {
  return storage.run(asOf, fn)
}

/**
 * Nitro middleware entry: bind the header to the current request async context.
 * Uses `enterWith` so later SSR / server-fn work on this request inherits the store.
 */
export function enterE2eAsOfFromHeaders(raw: string | null | undefined): void {
  storage.enterWith(parseE2eAsOfHeader(raw))
}
