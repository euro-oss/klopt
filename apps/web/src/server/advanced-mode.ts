import { createServerFn } from '@tanstack/react-start'
import {
  ADVANCED_MODE_COOKIE,
  ADVANCED_MODE_MAX_AGE_SECONDS,
  advancedModeCookieValue,
  isAdvancedModePreference,
  resolveAdvancedMode,
} from '~/lib/advanced-mode'

/**
 * Reading and setting Geavanceerd on the server.
 *
 * Same shape as theme/locale: the cookie arrives on the request so the first
 * paint of the nav already hides Journaalposten / Proefbalans when they should
 * be hidden, rather than flashing them and yanking them after hydration.
 */

export const getAdvancedMode = createServerFn({ method: 'GET' })
  .validator((input: { role: string }) => input)
  .handler(async ({ data }): Promise<boolean> => {
    const { getRequest } = await import('@tanstack/react-start/server')
    const cookies = getRequest().headers.get('cookie') ?? ''
    const match = new RegExp(`(?:^|;\\s*)${ADVANCED_MODE_COOKIE}=([^;]*)`).exec(cookies)
    const raw = match?.[1] === undefined ? null : decodeURIComponent(match[1])
    return resolveAdvancedMode(raw, data.role)
  })

export const setAdvancedMode = createServerFn({ method: 'POST' })
  .validator((input: { enabled: boolean }) => input)
  .handler(async ({ data }): Promise<{ enabled: boolean }> => {
    const { setCookie } = await import('@tanstack/react-start/server')
    const value = advancedModeCookieValue(data.enabled)
    if (!isAdvancedModePreference(value)) {
      throw new Error('Geavanceerd is aan or uit.')
    }

    setCookie(ADVANCED_MODE_COOKIE, value, {
      maxAge: ADVANCED_MODE_MAX_AGE_SECONDS,
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      secure: false,
    })

    return { enabled: data.enabled }
  })
