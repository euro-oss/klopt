import { resolveEmailTransport } from '@klopt/adapters'
import { createAuth, recordAuthEvent, type Auth } from '@klopt/db'
import { getDatabase } from './database.js'

/**
 * One auth instance per process, built lazily so that importing a handler in a
 * test does not require a signing secret.
 */

let auth: Auth | null = null

export function getAuth(): Auth {
  if (auth !== null) return auth

  const secret = process.env['KLOPT_AUTH_SECRET']
  if (secret === undefined || secret === '') {
    throw new Error(
      'KLOPT_AUTH_SECRET is not set. Generate one with `openssl rand -base64 32`. ' +
        'It signs session cookies; changing it signs everyone out.',
    )
  }

  auth = createAuth({
    database: getDatabase(),
    secret,
    baseUrl: process.env['KLOPT_BASE_URL'] ?? 'http://localhost:3000',
    // SMTP when configured, otherwise the code goes to the log — so a fresh
    // install with no mail server can still be signed into.
    email: resolveEmailTransport(),
    // The suites sign in far more often than a person does. Nothing else sets
    // this, and `createAuth` warns on the way past when it is set.
    disableRateLimit: process.env['KLOPT_RATE_LIMIT'] === 'off',
    /**
     * Spec 14 asks for a full audit on every authentication event.
     *
     * Swallowed rather than thrown: a log that cannot be written must not be
     * a log that stops people signing in. The failure goes to stderr, which
     * is where an operator finds out the audit trail has a hole in it.
     */
    onAuthEvent: async (event) => {
      try {
        await recordAuthEvent(getDatabase(), event)
      } catch (error: unknown) {
        console.error('[auth] could not record an authentication event', error)
      }
    },
  })
  return auth
}

/** Test seam. */
export function setAuthForTest(value: Auth | null): void {
  auth = value
}
