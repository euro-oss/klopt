import { resolveEmailTransport } from '@klopt/adapters'
import { createAuth, recordAuthEvent, type Auth } from '@klopt/db'
import { getDatabase } from './database.js'

/**
 * One auth instance per process, built lazily so that importing a handler in a
 * test does not require a signing secret.
 */

let auth: Auth | null = null

/**
 * The public origin of this instance.
 *
 * In production the value must be `https://…`. better-auth derives the session
 * cookie's `Secure` flag from a static base URL when one is passed, so an
 * unset or `http://` value would issue a non-Secure cookie even with
 * `NODE_ENV=production` (audit M4). Refusing to boot is louder than quietly
 * shipping the wrong cookie.
 */
export function resolveBaseUrl(
  environment: Record<string, string | undefined> = process.env,
): string {
  const configured = environment['KLOPT_BASE_URL']
  const baseUrl =
    configured !== undefined && configured.trim() !== ''
      ? configured.trim()
      : 'http://localhost:3000'

  if (environment['NODE_ENV'] === 'production' && !baseUrl.startsWith('https://')) {
    throw new Error(
      'NODE_ENV=production requires KLOPT_BASE_URL to be an https:// origin so the session cookie is Secure. Set it to the URL browsers actually use.',
    )
  }

  return baseUrl
}

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
    baseUrl: resolveBaseUrl(),
    // SMTP when configured, otherwise the code goes to the log — so a fresh
    // install with no mail server can still be signed into. Production refuses
    // the log transport (see resolveEmailTransport).
    email: resolveEmailTransport(),
    // Open until the operator closes it: `KLOPT_SIGNUP=closed` after the firm
    // is on the instance (audit M3).
    disableSignUp: process.env['KLOPT_SIGNUP'] === 'closed',
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
