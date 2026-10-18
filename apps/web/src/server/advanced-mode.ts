import { createServerFn } from '@tanstack/react-start'
import {
  ADVANCED_MODE_COOKIE_LEGACY,
  ADVANCED_MODE_COOKIE_PREFIX,
  readCookieValue,
  resolveAdvancedMode,
  retiredAdvancedModeCookieNames,
} from '~/lib/advanced-mode'
import { getSession } from '~/server/context'

/**
 * Reading and setting Geavanceerd on the server.
 *
 * Stored on `klopt.users.advanced_mode` for the signed-in session user. The
 * client never supplies a user id — both paths take it from the session.
 *
 * A one-shot cookie migrate keeps an explicit #64 choice if the column is
 * still null, then every retired cookie name is cleared so user ids never
 * linger in cookie names.
 */

async function clearRetiredCookies(cookieHeader: string): Promise<void> {
  const { setCookie } = await import('@tanstack/react-start/server')
  const names = new Set(retiredAdvancedModeCookieNames(cookieHeader))
  // Always drop the legacy shared name even when the header omitted it.
  names.add(ADVANCED_MODE_COOKIE_LEGACY)
  for (const name of names) {
    setCookie(name, '', {
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      secure: false,
    })
  }
}

/**
 * One-shot: if the DB has no choice yet, lift `'1'`/`'0'` from a retired
 * cookie into the column. Returns the stored preference afterwards.
 */
async function loadPreference(userId: string, cookieHeader: string): Promise<boolean | null> {
  const { getDatabase } = await import('~/api/database')
  const { advancedModeFor, setAdvancedModeFor } = await import('@klopt/db')
  const database = getDatabase()

  const stored = await advancedModeFor(database, userId)
  if (stored !== null) return stored

  // #64 wrote `klopt_advanced_<userId>`. Migrate once, never write cookies again.
  const safe = userId.replace(/[^A-Za-z0-9_-]/g, '_')
  const perUser = `${ADVANCED_MODE_COOKIE_PREFIX}${safe}`
  const raw = readCookieValue(cookieHeader, perUser)
  if (raw === '1' || raw === '0') {
    const enabled = raw === '1'
    await setAdvancedModeFor(database, userId, enabled)
    return enabled
  }

  return null
}

export const getAdvancedMode = createServerFn({ method: 'GET' })
  .validator((input: { role: string }) => input)
  .handler(async ({ data }): Promise<{ enabled: boolean; hasExplicit: boolean }> => {
    const session = await getSession()
    if (session === null) {
      throw new Error('Geavanceerd needs a signed-in user.')
    }

    const { getRequest } = await import('@tanstack/react-start/server')
    const cookies = getRequest().headers.get('cookie') ?? ''
    const preference = await loadPreference(session.user.id, cookies)
    await clearRetiredCookies(cookies)

    return {
      enabled: resolveAdvancedMode(preference, data.role),
      hasExplicit: preference !== null,
    }
  })

export const setAdvancedMode = createServerFn({ method: 'POST' })
  .validator((input: { enabled: boolean }) => input)
  .handler(async ({ data }): Promise<{ enabled: boolean }> => {
    const session = await getSession()
    if (session === null) {
      throw new Error('Geavanceerd needs a signed-in user.')
    }

    const { getDatabase } = await import('~/api/database')
    const { setAdvancedModeFor } = await import('@klopt/db')
    const { getRequest } = await import('@tanstack/react-start/server')

    await setAdvancedModeFor(getDatabase(), session.user.id, data.enabled)
    await clearRetiredCookies(getRequest().headers.get('cookie') ?? '')

    return { enabled: data.enabled }
  })
