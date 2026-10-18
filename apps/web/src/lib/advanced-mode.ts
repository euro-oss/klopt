/**
 * Geavanceerd toggle (PRD #40 / issue #44).
 *
 * Remembered per user as a cookie keyed by user id (`klopt_advanced_<userId>`).
 * Defaults: off for Eigenaar (owner), on for Boekhouder / Accountant /
 * Controleur — keyed to the role in the *active* administration. When it is
 * off, Journaalposten and Proefbalans leave the nav but stay in Cmd+K. There
 * is deliberately no shortcut (Shift+letter is table type-ahead) —
 * docs/keyboard-map.md.
 *
 * Cross-device / server-side storage is a follow-up on #44 (no migration here).
 */

/** Legacy browser-wide cookie; ignored on read and cleared on write. */
export const ADVANCED_MODE_COOKIE_LEGACY = 'klopt_advanced'

export const ADVANCED_MODE_COOKIE_PREFIX = 'klopt_advanced_'

/** A year: a presentation preference, not a session. */
export const ADVANCED_MODE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

/** Roles that see ledger numbers and VAT codes by default. */
export const ADVANCED_BY_DEFAULT_ROLES: readonly string[] = ['bookkeeper', 'accountant', 'auditor']

/** Cookie name for one user's explicit Geavanceerd choice. */
export function advancedModeCookieName(userId: string): string {
  // Cookie names are ASCII token-ish; user ids are uuid/nanoid already.
  const safe = userId.replace(/[^A-Za-z0-9_-]/g, '_')
  return `${ADVANCED_MODE_COOKIE_PREFIX}${safe}`
}

export function defaultAdvancedMode(role: string | null | undefined): boolean {
  if (role === null || role === undefined || role === '') return false
  return ADVANCED_BY_DEFAULT_ROLES.includes(role)
}

export function isAdvancedModePreference(value: string | null | undefined): value is '0' | '1' {
  return value === '0' || value === '1'
}

/**
 * Resolve the remembered preference, falling back to the role default.
 *
 * Cookie values are `'1'` / `'0'`. An absent or unknown cookie uses the role.
 */
export function resolveAdvancedMode(
  cookie: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (isAdvancedModePreference(cookie)) return cookie === '1'
  return defaultAdvancedMode(role)
}

export function advancedModeCookieValue(enabled: boolean): string {
  return enabled ? '1' : '0'
}

/** Read one cookie value from a Cookie header / `document.cookie` string. */
export function readCookieValue(cookieHeader: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`).exec(cookieHeader)
  return match?.[1] === undefined ? null : decodeURIComponent(match[1])
}

/** Read this user's preference from `document.cookie`. Null on the server. */
export function readAdvancedModeCookie(userId: string): string | null {
  if (typeof document === 'undefined') return null
  return readCookieValue(document.cookie, advancedModeCookieName(userId))
}

/** Persist this user's preference for a year. Clears the legacy shared cookie. */
export function writeAdvancedModeCookie(userId: string, enabled: boolean): void {
  if (typeof document === 'undefined') return
  // Drop the old browser-wide cookie so another account never inherits it.
  document.cookie = `${ADVANCED_MODE_COOKIE_LEGACY}=;path=/;max-age=0;samesite=lax`
  document.cookie = `${advancedModeCookieName(userId)}=${encodeURIComponent(advancedModeCookieValue(enabled))};path=/;max-age=${String(ADVANCED_MODE_MAX_AGE_SECONDS)};samesite=lax`
}
