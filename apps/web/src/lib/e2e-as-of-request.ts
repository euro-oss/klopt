/**
 * Client-safe indirection for request-scoped e2e as-of dates.
 * The Nitro middleware binds AsyncLocalStorage in `e2e-as-of-store.ts` on the server.
 */

type E2eAsOfReader = () => string | null

let reader: E2eAsOfReader | null = null

/** Server-only: wires ALS into `readE2eAsOfFromRequestScope`. */
export function bindE2eAsOfReader(next: E2eAsOfReader): void {
  reader = next
}

export function readE2eAsOfFromRequestScope(): string | null {
  return reader?.() ?? null
}
