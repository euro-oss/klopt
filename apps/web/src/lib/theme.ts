/**
 * Light, dark, or whatever the operating system is showing.
 *
 * The *preference* is what the cookie stores — light, dark or system. The
 * *appearance* is what the document ends up carrying — light or dark — and for
 * `system` that is decided by `prefers-color-scheme`. The preference has to
 * travel on a cookie the way the language does, because a theme applied after
 * hydration is a white flash in a dark room; the appearance of `system` cannot
 * be known on the server, so the first paint for that preference is settled by
 * a blocking script in `<head>` that reads the same cookie and asks the OS
 * before the body draws.
 */

export const THEME_COOKIE = 'klopt_theme'

/** A year: a theme is a preference, not a session. */
export const THEME_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

export type ThemePreference = (typeof THEME_PREFERENCES)[number]

/** What the document actually looks like, after `system` has been resolved. */
export type Theme = 'light' | 'dark'

/** Kept as an alias so older call sites that meant "the chosen value" still read. */
export const THEMES = THEME_PREFERENCES

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'light'

/** @deprecated Prefer `DEFAULT_THEME_PREFERENCE`. Light remains the default. */
export const DEFAULT_THEME: ThemePreference = DEFAULT_THEME_PREFERENCE

export function isThemePreference(value: string | null | undefined): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** @deprecated Prefer `isThemePreference`. Accepts the three preferences. */
export function isTheme(value: string | null | undefined): value is ThemePreference {
  return isThemePreference(value)
}

/** What was chosen, or the default. An unknown word is light, not system. */
export function resolveThemePreference(cookie: string | null | undefined): ThemePreference {
  return isThemePreference(cookie) ? cookie : DEFAULT_THEME_PREFERENCE
}

/**
 * @deprecated Prefer `resolveThemePreference`. Returns the preference as stored;
 * for `system` the appearance is still unresolved on the server.
 */
export function resolveTheme(cookie: string | null | undefined): ThemePreference {
  return resolveThemePreference(cookie)
}

/**
 * Light or dark, given a preference and what the OS is doing.
 *
 * `systemDark` is only consulted when the preference is `system`. On the
 * server it is `false`, so a first paint without the boot script is light —
 * the boot script is what makes a dark OS land dark before the body draws.
 */
export function resolveAppearance(preference: ThemePreference, systemDark: boolean): Theme {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

/**
 * The class the document carries.
 *
 * `.dark` is what the `dark:` utilities and the token overrides key off;
 * light is the absence of it, which keeps the default theme the one that
 * needs no class at all.
 */
export function themeClass(appearance: Theme): string | undefined {
  return appearance === 'dark' ? 'dark' : undefined
}

/**
 * Runs in `<head>` before the body paints.
 *
 * The server can honour light and dark from the cookie. It cannot honour
 * `system` — there is no `prefers-color-scheme` on the request — so without
 * this script a dark-OS visitor who chose Systeem would see a white flash and
 * then the dark tokens. The script reads the same cookie the server does and
 * asks the OS once, synchronously, before first paint.
 *
 * Kept as a string rather than a function body so it can be inlined without a
 * bundler trip that would rename locals or pull React into `<head>`.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=([^;]*)/);var p=m?decodeURIComponent(m[1]):'${DEFAULT_THEME_PREFERENCE}';var dark=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',dark);}catch(e){}})();`
