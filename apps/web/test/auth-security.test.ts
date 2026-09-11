import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  RATE_LIMIT,
  addMember,
  closeDatabase,
  createAuth,
  createDatabase,
  runMigrations,
  type Auth,
  type Database,
} from '@klopt/db'
import { cleanupSeededBackgroundWork, readAuditLogForActor, seedEntity } from '@klopt/db/testing'
import { createMemoryEmailTransport } from '@klopt/adapters'

/**
 * Spec 14: "Rate limiting and full audit on every authentication event."
 *
 * Both halves were relying on a framework default that nothing stated and
 * nothing tested — and for the audit half, on a default that does not exist:
 * signing in left no trace at all.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
const mailbox = createMemoryEmailTransport()

/** Auth with the shipped limits in force, which is the subject here. */
function limitedAuth(): Auth {
  return createAuth({
    database,
    secret: 'test-secret-not-for-production-0123456789',
    baseUrl: 'https://klopt.test',
    email: mailbox,
  })
}

async function codeFor(auth: Auth, email: string): Promise<string> {
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })
  const delivered = mailbox.sent.at(-1)
  if (delivered === undefined || delivered.to !== email) {
    throw new Error(`No code was sent to ${email}.`)
  }
  const otp = /\b(\d{6})\b/.exec(delivered.text)?.[1]
  if (otp === undefined) throw new Error('The message contained no six-digit code.')
  return otp
}

async function auditFor(email: string) {
  return readAuditLogForActor(database, email)
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
}, 60_000)

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  await closeDatabase(database)
})

describe('authentication is audited', () => {
  it('records the request for a code and the sign-in that follows', async () => {
    // Recorded against the administration this address can reach, because
    // that is where "who opened my books" is a question somebody asks.
    const entityId = await seedEntity(database)
    const email = `audited-${randomUUID()}@example.test`
    const events: unknown[] = []

    const auth = createAuth({
      database,
      secret: 'test-secret-not-for-production-0123456789',
      baseUrl: 'https://klopt.test',
      email: mailbox,
      disableRateLimit: true,
      onAuthEvent: async (event) => {
        events.push(event)
        const { recordAuthEvent } = await import('@klopt/db')
        await recordAuthEvent(database, event)
      },
    })

    // First sign-in: no account yet, so no membership to scope it to.
    const otp = await codeFor(auth, email)
    const response = await auth.api.signInEmailOTP({ body: { email, otp }, asResponse: true })
    const userId = ((await response.json()) as { user: { id: string } }).user.id
    await addMember(database, { entityId, userId, role: 'bookkeeper' })

    // Second sign-in, now that they are a member of something.
    const second = await codeFor(auth, email)
    await auth.api.signInEmailOTP({ body: { email, otp: second }, asResponse: true })

    const rows = await auditFor(email)
    const actions = rows.map((row) => row.action)

    expect(actions).toContain('auth.codeRequested')
    expect(actions).toContain('auth.signedIn')
    // Every row names the address, which for a failed or unrecognised attempt
    // is the only identifier there is.
    expect(rows.every((row) => row.actorId === email)).toBe(true)
    expect(rows.every((row) => row.resourceType === 'auth')).toBe(true)

    // The later ones are scoped to the books the address can now reach.
    expect(rows.some((row) => row.entityId === entityId)).toBe(true)
  })

  it('records an attempt on an address that reaches nothing, with no administration', async () => {
    // The shape of a probe. No owner's screen will show it — it belongs to no
    // administration — but it is in the table and the export, which is where
    // somebody investigating actually looks.
    const email = `stranger-${randomUUID()}@example.test`

    const auth = createAuth({
      database,
      secret: 'test-secret-not-for-production-0123456789',
      baseUrl: 'https://klopt.test',
      email: mailbox,
      disableRateLimit: true,
      onAuthEvent: async (event) => {
        const { recordAuthEvent } = await import('@klopt/db')
        await recordAuthEvent(database, event)
      },
    })

    await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })

    const rows = await auditFor(email)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.action).toBe('auth.codeRequested')
    expect(rows[0]?.entityId).toBeNull()
  })
})

describe('authentication is rate limited', () => {
  it('is on without anybody asking, and the numbers are the ones we chose', () => {
    // Pinned, because the whole point of the change was that these had been
    // whatever better-auth happened to default to.
    expect(RATE_LIMIT.window).toBe(60)
    expect(RATE_LIMIT.max).toBe(100)
    expect(RATE_LIMIT.sendCode).toEqual({ window: 3600, max: 6 })
  })

  it('refuses to keep sending codes to the same caller', async () => {
    // Through `auth.handler`, not `auth.api`. The limiter is request
    // middleware: calling the server-side API directly walks past it, which is
    // exactly the mistake that would have made this test pass while the real
    // endpoint stayed wide open.
    const auth = limitedAuth()
    const email = `flooded-${randomUUID()}@example.test`
    const ip = `198.51.100.${String(1 + (Date.now() % 200))}`

    const send = async (): Promise<number> => {
      const response = await auth.handler(
        new Request('https://klopt.test/api/auth/email-otp/send-verification-otp', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({ email, type: 'sign-in' }),
        }),
      )
      return response.status
    }

    const statuses: number[] = []
    for (let attempt = 0; attempt < RATE_LIMIT.sendCode.max + 2; attempt += 1) {
      statuses.push(await send())
    }

    expect(statuses[0]).toBe(200)
    expect(statuses.at(-1)).toBe(429)
  })
})
