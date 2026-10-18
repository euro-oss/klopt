import { createServerFn } from '@tanstack/react-start'
import {
  ADVANCED_MODE_COOKIE_LEGACY,
  ADVANCED_MODE_MAX_AGE_SECONDS,
  advancedModeCookieName,
  advancedModeCookieValue,
  isAdvancedModePreference,
  readCookieValue,
  resolveAdvancedMode,
} from '~/lib/advanced-mode'
import { getSession } from '~/server/context'

/**
 * Reading and setting Geavanceerd on the server.
 *
 * Same shape as theme/locale: the cookie arrives on the request so the first
 * paint of the nav already hides Journaalposten / Proefbalans when they should
 * be hidden, rather than flashing them and yanking them after hydration.
 *
 * The cookie is scoped to the signed-in user id so another account on the same
 * browser never inherits the preference. Cross-device persistence is a #44
 * follow-up (server-side store + migration).
 */

export const getAdvancedMode = createServerFn({ method: 'GET' })
  .validator((input: { role: string; userId: string }) => input)
  .handler(async ({ data }): Promise<{ enabled: boolean; hasExplicit: boolean }> => {
    const { getRequest } = await import('@tanstack/react-start/server')
    const cookies = getRequest().headers.get('cookie') ?? ''
    const raw = readCookieValue(cookies, advancedModeCookieName(data.userId))
    // Ignore the legacy browser-wide cookie — it is not a per-user preference.
    return {
      enabled: resolveAdvancedMode(raw, data.role),
      hasExplicit: isAdvancedModePreference(raw),
    }
  })

export const setAdvancedMode = createServerFn({ method: 'POST' })
  .validator((input: { enabled: boolean }) => input)
  .handler(async ({ data }): Promise<{ enabled: boolean }> => {
    const session = await getSession()
    if (session === null) {
      throw new Error('Geavanceerd needs a signed-in user.')
    }

    const { setCookie } = await import('@tanstack/react-start/server')
    const value = advancedModeCookieValue(data.enabled)
    if (!isAdvancedModePreference(value)) {
      throw new Error('Geavanceerd is aan or uit.')
    }

    setCookie(advancedModeCookieName(session.user.id), value, {
      maxAge: ADVANCED_MODE_MAX_AGE_SECONDS,
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      secure: false,
    })

    // Clear the pre-slice shared cookie so it cannot leak across accounts.
    setCookie(ADVANCED_MODE_COOKIE_LEGACY, '', {
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      secure: false,
    })

    return { enabled: data.enabled }
  })
