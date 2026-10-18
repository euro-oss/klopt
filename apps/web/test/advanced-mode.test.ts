import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  advancedModeFor,
  closeDatabase,
  createAuth,
  createDatabase,
  setAdvancedModeFor,
  type Auth,
  type Database,
} from '@klopt/db'
import { createMemoryEmailTransport } from '@klopt/adapters'
import { setAuthForTest } from '../src/api/auth-instance.js'
import { setDatabaseForTest } from '../src/api/database.js'

/**
 * Geavanceerd read/write is scoped to the session user (issue #44).
 *
 * The server functions take the user id from the signed-in session — never
 * from the client payload. These tests exercise the same repository calls the
 * handlers use, with two real accounts, and pin that A cannot read or write B.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let auth: Auth
const mailbox = createMemoryEmailTransport()

async function signUp(): Promise<{ userId: string }> {
  const email = `adv-${randomUUID()}@example.test`
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })
  const delivered = mailbox.sent.at(-1)
  if (delivered === undefined || delivered.to !== email) {
    throw new Error(`No sign-in code was sent to ${email}.`)
  }
  const otp = /\b(\d{6})\b/.exec(delivered.text)?.[1]
  if (otp === undefined) throw new Error('The message contained no six-digit code.')
  const response = await auth.api.signInEmailOTP({ body: { email, otp }, asResponse: true })
  const body = (await response.json()) as { user: { id: string } }
  return { userId: body.user.id }
}

beforeAll(async () => {
  const { runMigrations } = await import('@klopt/db')
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)

  auth = createAuth({
    database,
    secret: 'test-secret-not-for-production-0123456789',
    baseUrl: 'https://klopt.test',
    email: mailbox,
    disableRateLimit: true,
  })
  setAuthForTest(auth)
})

afterAll(async () => {
  await closeDatabase(database)
})

describe('Geavanceerd session-scoped storage', () => {
  it('reads and writes only the session user row', async () => {
    const a = await signUp()
    const b = await signUp()

    // What getAdvancedMode does with session.user.id — never a client userId.
    expect(await advancedModeFor(database, a.userId)).toBeNull()
    expect(await advancedModeFor(database, b.userId)).toBeNull()

    await setAdvancedModeFor(database, a.userId, true)

    expect(await advancedModeFor(database, a.userId)).toBe(true)
    // User A must not observe B's row, and must not have written it.
    expect(await advancedModeFor(database, b.userId)).toBeNull()

    await setAdvancedModeFor(database, b.userId, false)
    expect(await advancedModeFor(database, a.userId)).toBe(true)
    expect(await advancedModeFor(database, b.userId)).toBe(false)

    // A write scoped to A leaves B untouched.
    await setAdvancedModeFor(database, a.userId, false)
    expect(await advancedModeFor(database, a.userId)).toBe(false)
    expect(await advancedModeFor(database, b.userId)).toBe(false)
  })
})
