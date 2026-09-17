import { createServerFn } from '@tanstack/react-start'
import { isLocale, LOCALE_COOKIE, resolveLocale, type Locale } from '~/i18n/locale'

/**
 * Reading and setting the language, on the server.
 *
 * Both halves are here because both are about the request: the cookie arrives
 * on it, and the `Set-Cookie` goes back on the response. Nothing about the
 * language is decided in the browser.
 */

export const getLocale = createServerFn({ method: 'GET' }).handler(async (): Promise<Locale> => {
  const { getRequest } = await import('@tanstack/react-start/server')
  const request = getRequest()

  const cookies = request.headers.get('cookie') ?? ''
  const match = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`).exec(cookies)

  return resolveLocale({
    cookie: match?.[1] ?? null,
    acceptLanguage: request.headers.get('accept-language'),
  })
})

export const setLocale = createServerFn({ method: 'POST' })
  .validator((input: { locale: string }) => input)
  .handler(async ({ data }): Promise<{ locale: Locale }> => {
    if (!isLocale(data.locale)) throw new Error(`Not a language this speaks: ${data.locale}`)

    const { setCookie } = await import('@tanstack/react-start/server')

    setCookie(LOCALE_COOKIE, data.locale, {
      // A year: a language preference is not a session, and asking again every
      // fortnight is the kind of small rudeness nobody files a bug about.
      maxAge: 365 * 24 * 60 * 60,
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      // Not a credential. Marking it `secure` would drop it on the plain-http
      // dev server and make the switcher look broken there.
      secure: false,
    })

    return { locale: data.locale }
  })
