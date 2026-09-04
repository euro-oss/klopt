import { createAuth, type Auth } from '@klopt/db'
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
  })
  return auth
}

/** Test seam. */
export function setAuthForTest(value: Auth | null): void {
  auth = value
}
