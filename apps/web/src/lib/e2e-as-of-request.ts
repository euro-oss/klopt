/**
 * Client-safe indirection for reading e2e as-of from the active HTTP request.
 * Wired on the server in `e2e-as-of-server-bridge.ts`.
 */

type HeaderReader = (name: string) => string | undefined

let reader: HeaderReader | null = null

export function bindE2eAsOfHeaderReader(next: HeaderReader | null): void {
  reader = next
}

export function hasE2eAsOfHeaderReader(): boolean {
  return reader !== null
}

export function readE2eAsOfRequestHeader(name: string): string | undefined {
  return reader?.(name)
}
