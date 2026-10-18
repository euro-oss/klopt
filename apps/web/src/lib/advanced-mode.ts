/**
 * Geavanceerd toggle (PRD #40 / issue #44).
 *
 * Remembered per browser as a cookie. Defaults: off for Eigenaar (owner), on
 * for Boekhouder / Accountant / Controleur. When it is off, Journaalposten and
 * Proefbalans leave the nav but stay in ⌘K. There is deliberately no shortcut
 * (Shift+letter is table type-ahead) — docs/keyboard-map.md.
 */

export const ADVANCED_MODE_COOKIE = 'klopt_advanced'

/** A year: a presentation preference, not a session. */
export const ADVANCED_MODE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

/** Roles that see ledger numbers and VAT codes by default. */
export const ADVANCED_BY_DEFAULT_ROLES: readonly string[] = ['bookkeeper', 'accountant', 'auditor']

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

/** Read the preference from `document.cookie`. Null on the server. */
export function readAdvancedModeCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = new RegExp(`(?:^|;\\s*)${ADVANCED_MODE_COOKIE}=([^;]*)`).exec(document.cookie)
  return match?.[1] === undefined ? null : decodeURIComponent(match[1])
}

/** Persist the preference for a year. Client-only. */
export function writeAdvancedModeCookie(enabled: boolean): void {
  if (typeof document === 'undefined') return
  document.cookie = `${ADVANCED_MODE_COOKIE}=${encodeURIComponent(advancedModeCookieValue(enabled))};path=/;max-age=${String(ADVANCED_MODE_MAX_AGE_SECONDS)};samesite=lax`
}
