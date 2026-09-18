/**
 * Light or dark, decided on the server.
 *
 * Both themes are real and light is the default — not "whatever the operating
 * system says", which would hand a bookkeeper on a dark laptop a theme nobody
 * chose for them, and not a client-side guess either: a theme read from
 * `matchMedia` during render produces different markup on each side of
 * hydration and React throws the tree away. So it travels the way the
 * language does, on a cookie, resolved in the root loader, painted into the
 * document before the first frame.
 */

export const THEME_COOKIE = 'klopt_theme'

/** A year: a theme is a preference, not a session. */
export const THEME_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

export const THEMES = ['light', 'dark'] as const

export type Theme = (typeof THEMES)[number]

export const DEFAULT_THEME: Theme = 'light'

export function isTheme(value: string | null | undefined): value is Theme {
  return value === 'light' || value === 'dark'
}

/** What was chosen, or the default. There is no third answer. */
export function resolveTheme(cookie: string | null | undefined): Theme {
  return isTheme(cookie) ? cookie : DEFAULT_THEME
}

/**
 * The class the document carries.
 *
 * `.dark` is what the `dark:` utilities and the token overrides key off;
 * light is the absence of it, which keeps the default theme the one that
 * needs no class at all.
 */
export function themeClass(theme: Theme): string | undefined {
  return theme === 'dark' ? 'dark' : undefined
}
