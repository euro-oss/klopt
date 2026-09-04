import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import {
  addMember,
  closeDatabase,
  createAuth,
  createDatabase,
  membershipsFor,
  runMigrations,
  setActiveEntity,
  type Auth,
  type Database,
} from '@klopt/db'
import { seedEntity } from '@klopt/db/testing'
import { createMemoryEmailTransport } from '@klopt/adapters'
import { resolveRequestContext } from '../src/api/auth.js'
import { setAuthForTest } from '../src/api/auth-instance.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { handleCloseYear, handleSetRgsMappings } from '../src/api/handlers/compliance.js'
import { handlePostJournalEntry } from '../src/api/handlers/ledger.js'
import { postJournalEntryBody } from '../src/api/schemas.js'

/**
 * A signed-in human and a machine token produce the same `RequestContext`, and
 * a role is only a bundle of permissions.
 *
 * These run against real better-auth sessions rather than a stub, because the
 * thing worth testing is that the cookie a browser actually gets resolves to
 * the permissions the role actually has.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let auth: Auth

/** Collects the sign-in codes so a test can read one back. */
const mailbox = createMemoryEmailTransport()

/**
 * Sign a brand-new address in with a one-time code.
 *
 * The code is read from the transport rather than the database, because it is
 * stored hashed — deliberately, since it is now the only credential.
 */
async function signUp(): Promise<{ userId: string; cookie: string }> {
  const email = `user-${randomUUID()}@example.test`

  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })

  const delivered = mailbox.sent.at(-1)
  if (delivered === undefined || delivered.to !== email) {
    throw new Error(`No sign-in code was sent to ${email}.`)
  }
  const otp = /\b(\d{6})\b/.exec(delivered.text)?.[1]
  if (otp === undefined) throw new Error('The message contained no six-digit code.')

  const response = await auth.api.signInEmailOTP({ body: { email, otp }, asResponse: true })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie === null) throw new Error('No session cookie was issued.')

  const body = (await response.json()) as { user: { id: string } }
  return { userId: body.user.id, cookie: setCookie.split(';')[0]! }
}

const request = (cookie: string, idempotencyKey?: string): Request => {
  const headers = new Headers({ cookie })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return new Request('https://klopt.test/x', { headers })
}

const entryBody = () =>
  postJournalEntryBody.parse({
    journalCode: 'MEM',
    bookingDate: '2026-03-15',
    documentDate: '2026-03-15',
    description: 'Test',
    lines: [
      { accountNumber: '1100', debit: '10000' },
      { accountNumber: '0500', credit: '10000' },
    ],
  })

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)

  auth = createAuth({
    database,
    secret: 'test-secret-not-for-production-0123456789',
    baseUrl: 'https://klopt.test',
    email: mailbox,
  })
  setAuthForTest(auth)
}, 60_000)

afterAll(async () => {
  setAuthForTest(null)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('a session resolves to the role’s permissions', () => {
  it('gives a bookkeeper post but not close', async () => {
    const entityId = await seedEntity(database)
    const { userId, cookie } = await signUp()
    await addMember(database, { entityId, userId, role: 'bookkeeper' })

    const context = await resolveRequestContext({ database, request: request(cookie) })

    expect(context.actor.kind).toBe('human')
    expect(context.actor.id).toBe(userId)
    expect(context.entityId).toBe(entityId)
    expect(context.permissions.has('ledger:post')).toBe(true)
    expect(context.permissions.has('ledger:close')).toBe(false)
  })

  it('lets a bookkeeper post', async () => {
    const entityId = await seedEntity(database)
    const { userId, cookie } = await signUp()
    await addMember(database, { entityId, userId, role: 'bookkeeper' })

    const result = await handlePostJournalEntry(
      await resolveRequestContext({ database, request: request(cookie, uuidv7()) }),
      entryBody(),
    )
    expect(result.status).toBe(201)
  })

  it('refuses an auditor the same posting', async () => {
    const entityId = await seedEntity(database)
    const { userId, cookie } = await signUp()
    await addMember(database, { entityId, userId, role: 'auditor' })

    await expect(
      handlePostJournalEntry(
        await resolveRequestContext({ database, request: request(cookie, uuidv7()) }),
        entryBody(),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('refuses a bookkeeper a year close but allows an accountant', async () => {
    const entityId = await seedEntity(database, { alsoFiscalYears: ['2027'] })
    const bookkeeper = await signUp()
    const accountant = await signUp()
    await addMember(database, { entityId, userId: bookkeeper.userId, role: 'bookkeeper' })
    await addMember(database, { entityId, userId: accountant.userId, role: 'accountant' })

    const close = {
      fiscalYear: '2026',
      resultAccountNumber: '0500',
      journalCode: 'MEM',
      carryForward: true,
      dryRun: true,
    }

    await expect(
      handleCloseYear(
        await resolveRequestContext({ database, request: request(bookkeeper.cookie, uuidv7()) }),
        close,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })

    const allowed = await handleCloseYear(
      await resolveRequestContext({ database, request: request(accountant.cookie, uuidv7()) }),
      close,
    )
    expect(allowed.body.dryRun).toBe(true)
  })

  it('refuses an auditor a mapping change', async () => {
    const entityId = await seedEntity(database)
    const { userId, cookie } = await signUp()
    await addMember(database, { entityId, userId, role: 'auditor' })

    await expect(
      handleSetRgsMappings(await resolveRequestContext({ database, request: request(cookie) }), {
        mappings: [{ accountNumber: '1300', rgsCode: 'BVorDebHad' }],
        dryRun: false,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('entity scoping for humans', () => {
  it('refuses a signed-in user with no memberships', async () => {
    const { cookie } = await signUp()
    await expect(
      resolveRequestContext({ database, request: request(cookie) }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('cannot reach an entity it is not a member of, and is told nothing about it', async () => {
    const mine = await seedEntity(database)
    const theirs = await seedEntity(database)
    const { userId, cookie } = await signUp()
    await addMember(database, { entityId: mine, userId, role: 'owner' })

    // Not "forbidden": that would confirm the entity exists.
    await expect(
      resolveRequestContext({ database, request: request(cookie), entityId: theirs }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('remembers which entity the session switched to', async () => {
    const first = await seedEntity(database)
    const second = await seedEntity(database)
    const { userId, cookie } = await signUp()
    await addMember(database, { entityId: first, userId, role: 'owner' })
    await addMember(database, { entityId: second, userId, role: 'auditor' })

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) })
    await setActiveEntity(database, session!.session.token, second)

    const context = await resolveRequestContext({ database, request: request(cookie) })
    expect(context.entityId).toBe(second)
    // And the role that comes with it.
    expect(context.permissions.has('ledger:post')).toBe(false)
  })

  it('lists every entity the user may open, for the switcher', async () => {
    const first = await seedEntity(database)
    const second = await seedEntity(database)
    const { userId } = await signUp()
    await addMember(database, { entityId: first, userId, role: 'owner' })
    await addMember(database, { entityId: second, userId, role: 'accountant' })

    const memberships = await membershipsFor(database, userId)
    expect(memberships).toHaveLength(2)
    expect(memberships.map((membership) => membership.role).sort()).toEqual(['accountant', 'owner'])
  })
})

describe('a token and a session are the same thing downstream', () => {
  it('produces a context of the same shape, differing only in actor kind', async () => {
    const entityId = await seedEntity(database)
    const { userId, cookie } = await signUp()
    await addMember(database, { entityId, userId, role: 'owner' })

    const human = await resolveRequestContext({ database, request: request(cookie) })

    const { issueToken } = await import('@klopt/db')
    const { token } = await issueToken(database, {
      entityId,
      name: 'machine',
      permissions: ['ledger:read'],
      actorKind: 'script',
      actorId: 'integration',
    })
    const machine = await resolveRequestContext({
      database,
      request: new Request('https://klopt.test/x', {
        headers: { authorization: `Bearer ${token}` },
      }),
    })

    expect(Object.keys(human).sort()).toEqual(Object.keys(machine).sort())
    expect(human.actor.kind).toBe('human')
    expect(machine.actor.kind).toBe('script')
    expect(human.entityId).toBe(machine.entityId)
  })

  it('prefers a bearer token when both are presented', async () => {
    // A script hitting the API from a browser session must act as the script.
    const entityId = await seedEntity(database)
    const { userId, cookie } = await signUp()
    await addMember(database, { entityId, userId, role: 'owner' })

    const { issueToken } = await import('@klopt/db')
    const { token } = await issueToken(database, {
      entityId,
      name: 'machine',
      permissions: ['ledger:read'],
      actorKind: 'agent',
      actorId: 'assistant',
      principalId: userId,
    })

    const context = await resolveRequestContext({
      database,
      request: new Request('https://klopt.test/x', {
        headers: { cookie, authorization: `Bearer ${token}` },
      }),
    })

    expect(context.actor).toEqual({ kind: 'agent', id: 'assistant', principalId: userId })
  })
})
