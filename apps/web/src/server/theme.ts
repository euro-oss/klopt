import { createServerFn } from '@tanstack/react-start'
import {
  isThemePreference,
  resolveThemePreference,
  THEME_COOKIE,
  THEME_MAX_AGE_SECONDS,
  type ThemePreference,
} from '~/lib/theme'

/**
 * Reading and setting the theme preference, on the server.
 *
 * The same shape as the language, and for the same reason: the cookie arrives
 * on the request and the `Set-Cookie` goes back on the response, so the first
 * paint of light and dark is already right. `system` cannot be resolved here —
 * there is no operating system on the request — and is settled by the boot
 * script in `<head>` before the body draws.
 */

export const getTheme = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ThemePreference> => {
    const { getRequest } = await import('@tanstack/react-start/server')
    const cookies = getRequest().headers.get('cookie') ?? ''
    const match = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]*)`).exec(cookies)
    return resolveThemePreference(match?.[1])
  },
)

export const setTheme = createServerFn({ method: 'POST' })
  .validator((input: { theme: string }) => input)
  .handler(async ({ data }): Promise<{ theme: ThemePreference }> => {
    if (!isThemePreference(data.theme)) {
      throw new Error('A theme is light, dark or system.')
    }

    const { setCookie } = await import('@tanstack/react-start/server')

    setCookie(THEME_COOKIE, data.theme, {
      maxAge: THEME_MAX_AGE_SECONDS,
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      // Not a credential, and marking it `secure` would drop it on the plain
      // http dev server and make the switch look broken there.
      secure: false,
    })

    return { theme: data.theme }
  })
