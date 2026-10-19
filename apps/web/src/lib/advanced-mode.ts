/**
 * Geavanceerd toggle (PRD #40 / issue #44).
 *
 * Remembered per user on the server (`klopt.users.advanced_mode`). Null means
 * derive from the role in the *active* administration. Defaults: off for
 * Eigenaar (owner), on for Boekhouder / Accountant / Controleur. When it is
 * off, Journaalposten and Proefbalans leave the nav but stay in Cmd+K. There
 * is deliberately no shortcut (Shift+letter is table type-ahead) —
 * docs/keyboard-map.md.
 *
 * Pre-#64 / #64 cookies are retired. Legacy names are cleared on read/write so
 * an old browser never re-applies a cookie choice, and cookie names never
 * carry a raw user id going forward.
 */

/** Legacy browser-wide cookie from the first shell slice; cleared on touch. */
export const ADVANCED_MODE_COOKIE_LEGACY = 'klopt_advanced'

/**
 * Prefix of the short-lived per-user cookie from #64. Cleared on touch; never
 * written again (raw user ids must not appear in cookie names).
 */
export const ADVANCED_MODE_COOKIE_PREFIX = 'klopt_advanced_'

/** Roles that see ledger numbers and VAT codes by default. */
export const ADVANCED_BY_DEFAULT_ROLES: readonly string[] = ['bookkeeper', 'accountant', 'auditor']

export function defaultAdvancedMode(role: string | null | undefined): boolean {
  if (role === null || role === undefined || role === '') return false
  return ADVANCED_BY_DEFAULT_ROLES.includes(role)
}

/**
 * Resolve the remembered preference, falling back to the role default.
 *
 * `preference` is the nullable column: boolean when explicit, null when not.
 */
export function resolveAdvancedMode(
  preference: boolean | null | undefined,
  role: string | null | undefined,
): boolean {
  if (preference === true || preference === false) return preference
  return defaultAdvancedMode(role)
}

/** Read one cookie value from a Cookie header / `document.cookie` string. */
export function readCookieValue(cookieHeader: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`).exec(cookieHeader)
  return match?.[1] === undefined ? null : decodeURIComponent(match[1])
}

/**
 * Cookie names from #64 that start with `klopt_advanced_` (plus the legacy
 * shared name). Used only to expire them.
 */
export function retiredAdvancedModeCookieNames(cookieHeader: string): string[] {
  const names = new Set<string>()
  for (const part of cookieHeader.split(';')) {
    const name = part.trim().split('=', 1)[0]
    if (name === undefined || name === '') continue
    if (name === ADVANCED_MODE_COOKIE_LEGACY || name.startsWith(ADVANCED_MODE_COOKIE_PREFIX)) {
      names.add(name)
    }
  }
  return [...names]
}

/**
 * Payload for the Geavanceerd write server function.
 *
 * Only `enabled` is accepted. A client-supplied `userId` (or any other field)
 * is ignored — the session user is the sole scope on the server.
 */
export function parseAdvancedModeWrite(input: unknown): { enabled: boolean } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new AdvancedModeValidationError('enabled must be a boolean')
  }
  const enabled = (input as { readonly enabled?: unknown }).enabled
  if (typeof enabled !== 'boolean') {
    throw new AdvancedModeValidationError('enabled must be a boolean')
  }
  return { enabled }
}

/** Bad write payload — the server maps this to HTTP 400. */
export class AdvancedModeValidationError extends Error {
  readonly status = 400 as const

  constructor(message: string) {
    super(message)
    this.name = 'AdvancedModeValidationError'
  }
}
