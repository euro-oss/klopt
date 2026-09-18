import { createServerFn } from '@tanstack/react-start'
import {
  REPORT_YEAR_MAX_AGE_SECONDS,
  REPORT_YEAR_COOKIE,
  isFiscalYearCode,
} from '~/lib/fiscal-year'
import { contextFromRequest, reportYear, run } from './internal'

/**
 * The book year the shell shows, and changing it.
 *
 * Both halves are about the request, the way the language is: the cookie
 * arrives on it and the `Set-Cookie` goes back on the response. Nothing about
 * which year a screen is reading is decided in the browser — a year resolved
 * client-side would render one thing on the server and another after
 * hydration, and React throws that tree away.
 *
 * The list comes from `GET /api/v1/fiscal-years`, so the picker offers the
 * years this administration has rather than a range somebody typed.
 */

export const getReportYear = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => reportYear(await contextFromRequest())),
)

export const setReportYear = createServerFn({ method: 'POST' })
  .validator((input: { code: string }) => input)
  .handler(async ({ data }) => {
    if (!isFiscalYearCode(data.code)) {
      throw new Error('A book year is labelled by its four-digit start year.')
    }

    const { setCookie } = await import('@tanstack/react-start/server')

    setCookie(REPORT_YEAR_COOKIE, data.code, {
      maxAge: REPORT_YEAR_MAX_AGE_SECONDS,
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      // Not a credential, and marking it `secure` would drop it on the plain
      // http dev server and make the picker look broken there.
      secure: false,
    })

    return { code: data.code }
  })
