import { createServerFn } from '@tanstack/react-start'
import { isTheme, resolveTheme, THEME_COOKIE, THEME_MAX_AGE_SECONDS, type Theme } from '~/lib/theme'

/**
 * Reading and setting the theme, on the server.
 *
 * The same shape as the language, and for the same reason: the cookie arrives
 * on the request and the `Set-Cookie` goes back on the response, so the first
 * paint is already right. A theme applied after hydration is a white flash in
 * a dark room.
 */

export const getTheme = createServerFn({ method: 'GET' }).handler(async (): Promise<Theme> => {
  const { getRequest } = await import('@tanstack/react-start/server')
  const cookies = getRequest().headers.get('cookie') ?? ''
  const match = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]*)`).exec(cookies)
  return resolveTheme(match?.[1])
})

export const setTheme = createServerFn({ method: 'POST' })
  .validator((input: { theme: string }) => input)
  .handler(async ({ data }): Promise<{ theme: Theme }> => {
    if (!isTheme(data.theme)) throw new Error('A theme is light or dark.')

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
