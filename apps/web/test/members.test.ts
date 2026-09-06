import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import {
  closeDatabase,
  createAuth,
  createDatabase,
  issueToken,
  membershipsFor,
  runMigrations,
  type Auth,
  type Database,
} from '@klopt/db'
import { readAuditLog } from '@klopt/db/testing'
import { createMemoryEmailTransport } from '@klopt/adapters'
import { resolveRequestContext, resolveSetupContext } from '../src/api/auth.js'
import { setAuthForTest } from '../src/api/auth-instance.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { setEmailTransportForTest } from '../src/api/email.js'
import { ApiError } from '../src/api/errors.js'
import {
  handleInviteMember,
  handleListMembers,
  handleRemoveMember,
  handleSetMemberRole,
} from '../src/api/handlers/members.js'
import { handleCreateEntity } from '../src/api/handlers/setup.js'
import { handlePostJournalEntry } from '../src/api/handlers/ledger.js'
import { createEntityBody, postJournalEntryBody } from '../src/api/schemas.js'

/**
 * Letting somebody else in, and taking it away again.
 *
 * Against a real database and real better-auth sessions, because the load-
 * bearing part is not the SQL: it is that an invitation issued to an address
 * with no account turns into a membership the moment that address signs in,
 * and that a session then resolves to the role it was invited in.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let auth: Auth

const mailbox = createMemoryEmailTransport()
const invitations = createMemoryEmailTransport()

async function signUp(
  address?: string,
): Promise<{ userId: string; email: string; cookie: string }> {
  const email = address ?? `member-${randomUUID()}@example.test`
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })

  const delivered = mailbox.sent.at(-1)
  if (delivered === undefined) throw new Error('No sign-in code was sent.')
  const otp = /\b(\d{6})\b/.exec(delivered.text)?.[1]
  if (otp === undefined) throw new Error('The message contained no six-digit code.')

  const response = await auth.api.signInEmailOTP({ body: { email, otp }, asResponse: true })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie === null) throw new Error('No session cookie was issued.')

  const body = (await response.json()) as { user: { id: string } }
  return { userId: body.user.id, email, cookie: setCookie.split(';')[0]! }
}

const request = (headers: Record<string, string>): Request =>
  new Request('https://klopt.test/api/v1/members', { headers: new Headers(headers) })

/** A signed-in owner with a freshly provisioned administration. */
async function anOwner(): Promise<{
  entityId: string
  cookie: string
  userId: string
  email: string
}> {
  const { userId, email, cookie } = await signUp()
  const entityId = uuidv7()
  await handleCreateEntity(
    await resolveSetupContext({ database, request: request({ cookie }) }),
    entityId,
    createEntityBody.parse({ name: 'Toegang BV', firstFiscalYear: '2026' }),
  )
  return { entityId, cookie, userId, email }
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
  setEmailTransportForTest(invitations)

  auth = createAuth({
    database,
    secret: 'test-secret-not-for-production-0123456789',
    baseUrl: 'https://klopt.test',
    email: mailbox,
  })
  setAuthForTest(auth)
}, 60_000)

afterEach(() => {
  invitations.sent.length = 0
})

afterAll(async () => {
  setAuthForTest(null)
  setDatabaseForTest(null)
  setEmailTransportForTest(null)
  await closeDatabase(database)
})

describe('inviting somebody who has no account yet', () => {
  it('waits for them, then lets them in with the role they were invited as', async () => {
    const owner = await anOwner()
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: owner.cookie }),
    })
    const invitee = `nieuw-${randomUUID()}@example.test`

    const invited = await handleInviteMember(context, { email: invitee, role: 'accountant' })
    expect(invited.status).toBe(201)
    expect(invited.body).toMatchObject({ joinedImmediately: false, delivered: true })

    // The message really went out, and says how to use it.
    const message = invitations.sent.at(-1)
    expect(message?.to).toBe(invitee)
    expect(message?.text).toContain('/sign-in')
    expect(message?.text).toContain('accountant')

    // Before they sign in they are an invitation, not a member.
    const before = await handleListMembers(context)
    expect(before.body.members).toHaveLength(1)
    expect(before.body.invitations.map((item) => item.email)).toEqual([invitee])

    // Signing in is accepting. There is no separate acceptance step, because
    // the code arriving in that mailbox already proved the only thing one
    // would check.
    const joined = await signUp(invitee)
    expect(await membershipsFor(database, joined.userId)).toEqual([
      { entityId: owner.entityId, entityName: 'Toegang BV', role: 'accountant' },
    ])

    const theirContext = await resolveRequestContext({
      database,
      request: request({ cookie: joined.cookie }),
    })
    expect(theirContext.permissions.has('ledger:close')).toBe(true)
    expect(theirContext.permissions.has('members:manage')).toBe(false)

    const after = await handleListMembers(context)
    expect(after.body.invitations).toEqual([])
    expect(after.body.members.map((item) => item.email).sort()).toEqual(
      [owner.email, invitee].sort(),
    )
  })

  it('matches the address whatever case it was typed in', async () => {
    const owner = await anOwner()
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: owner.cookie }),
    })
    const invitee = `Gemengd-${randomUUID()}@Example.TEST`

    await handleInviteMember(context, { email: invitee, role: 'auditor' })
    const joined = await signUp(invitee.toLowerCase())

    expect(await membershipsFor(database, joined.userId)).toHaveLength(1)
  })

  it('re-inviting resends rather than making a second invitation', async () => {
    const owner = await anOwner()
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: owner.cookie }),
    })
    const invitee = `herhaald-${randomUUID()}@example.test`

    const first = await handleInviteMember(context, { email: invitee, role: 'auditor' })
    const second = await handleInviteMember(context, { email: invitee, role: 'bookkeeper' })

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(invitations.sent).toHaveLength(2)

    const list = await handleListMembers(context)
    expect(list.body.invitations).toHaveLength(1)
    // The second invitation's role is the one that counts.
    expect(list.body.invitations[0]?.role).toBe('bookkeeper')
  })

  it('withdrawing an invitation stops it being claimed', async () => {
    const owner = await anOwner()
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: owner.cookie }),
    })
    const invitee = `ingetrokken-${randomUUID()}@example.test`

    await handleInviteMember(context, { email: invitee, role: 'bookkeeper' })
    const list = await handleListMembers(context)
    const invitationId = list.body.invitations[0]!.invitationId

    const removed = await handleRemoveMember(context, invitationId)
    expect(removed.body).toEqual({ removed: 'invitation' })

    const joined = await signUp(invitee)
    expect(await membershipsFor(database, joined.userId)).toEqual([])
  })
})

describe('inviting somebody who already has an account', () => {
  it('gives them access immediately, with no message to wait for', async () => {
    const owner = await anOwner()
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: owner.cookie }),
    })
    const other = await signUp()

    const invited = await handleInviteMember(context, { email: other.email, role: 'bookkeeper' })

    expect(invited.body).toMatchObject({ joinedImmediately: true })
    expect(invitations.sent).toHaveLength(0)
    expect(await membershipsFor(database, other.userId)).toHaveLength(1)
  })
})

describe('changing and revoking access', () => {
  it('re-roles a member, and the change is live on their next request', async () => {
    const owner = await anOwner()
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: owner.cookie }),
    })
    const other = await signUp()

    await handleInviteMember(context, { email: other.email, role: 'auditor' })

    const asAuditor = await resolveRequestContext({
      database,
      request: request({ cookie: other.cookie, 'idempotency-key': uuidv7() }),
    })
    await expect(
      handlePostJournalEntry(
        asAuditor,
        postJournalEntryBody.parse({
          journalCode: 'MEM',
          bookingDate: '2026-03-15',
          documentDate: '2026-03-15',
          description: 'Nee',
          lines: [
            { accountNumber: '1100', debit: '100' },
            { accountNumber: '8000', credit: '100' },
          ],
        }),
      ),
    ).rejects.toThrow(ApiError)

    await handleSetMemberRole(context, other.userId, { role: 'bookkeeper' })

    const asBookkeeper = await resolveRequestContext({
      database,
      request: request({ cookie: other.cookie, 'idempotency-key': uuidv7() }),
    })
    const posted = await handlePostJournalEntry(
      asBookkeeper,
      postJournalEntryBody.parse({
        journalCode: 'MEM',
        bookingDate: '2026-03-15',
        documentDate: '2026-03-15',
        description: 'Wel',
        lines: [
          { accountNumber: '1100', debit: '100' },
          { accountNumber: '8000', credit: '100' },
        ],
      }),
    )
    expect(posted.status).toBe(201)
  })

  it('removing a member takes their access away at once', async () => {
    const owner = await anOwner()
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: owner.cookie }),
    })
    const other = await signUp()

    await handleInviteMember(context, { email: other.email, role: 'bookkeeper' })
    await handleRemoveMember(context, other.userId)

    // No memberships at all, so the session cannot resolve an entity.
    await expect(
      resolveRequestContext({ database, request: request({ cookie: other.cookie }) }),
    ).rejects.toThrow(/not a member of any entity/)
  })

  it('refuses to remove the last owner', async () => {
    const owner = await anOwner()
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: owner.cookie }),
    })

    await expect(handleRemoveMember(context, owner.userId)).rejects.toThrow(/last owner/)
  })

  it('refuses to demote the last owner', async () => {
    const owner = await anOwner()
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: owner.cookie }),
    })

    await expect(handleSetMemberRole(context, owner.userId, { role: 'auditor' })).rejects.toThrow(
      /last owner/,
    )
  })

  it('lets an owner step down once there is a second one', async () => {
    const owner = await anOwner()
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: owner.cookie }),
    })
    const other = await signUp()

    await handleInviteMember(context, { email: other.email, role: 'owner' })
    const stepped = await handleSetMemberRole(context, owner.userId, { role: 'bookkeeper' })

    expect(stepped.body).toEqual({ userId: owner.userId, role: 'bookkeeper' })
  })

  it('refuses somebody who is not a member of this administration', async () => {
    const owner = await anOwner()
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: owner.cookie }),
    })
    const stranger = await signUp()

    await expect(
      handleSetMemberRole(context, stranger.userId, { role: 'auditor' }),
    ).rejects.toThrow(/not a member/)
  })
})

describe('only an owner manages access', () => {
  it('refuses a bookkeeper', async () => {
    const owner = await anOwner()
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: owner.cookie }),
    })
    const other = await signUp()
    await handleInviteMember(context, { email: other.email, role: 'bookkeeper' })

    const theirs = await resolveRequestContext({
      database,
      request: request({ cookie: other.cookie }),
    })

    await expect(handleListMembers(theirs)).rejects.toThrow(/Only an owner/)
    await expect(
      handleInviteMember(theirs, { email: 'x@example.test', role: 'auditor' }),
    ).rejects.toThrow(ApiError)
  })

  it('refuses an accountant, who can close a year but not hand out keys', async () => {
    const owner = await anOwner()
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: owner.cookie }),
    })
    const other = await signUp()
    await handleInviteMember(context, { email: other.email, role: 'accountant' })

    const theirs = await resolveRequestContext({
      database,
      request: request({ cookie: other.cookie }),
    })
    expect(theirs.permissions.has('ledger:close')).toBe(true)
    await expect(handleListMembers(theirs)).rejects.toThrow(/Only an owner/)
  })

  it('lets a token do it only when it was scoped for it', async () => {
    const owner = await anOwner()
    const scoped = await issueToken(database, {
      entityId: owner.entityId,
      name: 'ops',
      permissions: ['members:manage'],
      actorKind: 'script',
      actorId: 'ops',
    })
    const narrow = await issueToken(database, {
      entityId: owner.entityId,
      name: 'reader',
      permissions: ['ledger:read'],
      actorKind: 'script',
      actorId: 'reader',
    })

    const withScope = await resolveRequestContext({
      database,
      request: request({ authorization: `Bearer ${scoped.token}` }),
    })
    const without = await resolveRequestContext({
      database,
      request: request({ authorization: `Bearer ${narrow.token}` }),
    })

    expect((await handleListMembers(withScope)).status).toBe(200)
    await expect(handleListMembers(without)).rejects.toThrow(/Only an owner/)
  })
})

describe('the audit log', () => {
  it('records who was let in, re-roled and removed', async () => {
    const owner = await anOwner()
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: owner.cookie }),
    })
    const other = await signUp()

    await handleInviteMember(context, { email: other.email, role: 'auditor' })
    await handleSetMemberRole(context, other.userId, { role: 'bookkeeper' })
    await handleRemoveMember(context, other.userId)

    const rows = await readAuditLog(database, owner.entityId, 'entity_member')

    expect(rows.map((row) => row.action)).toEqual([
      'members.invite',
      'members.setRole',
      'members.remove',
    ])
    // Attributed to the human who did it, not to the system.
    expect(new Set(rows.map((row) => row.actorId))).toEqual(new Set([owner.userId]))
    // And it says what changed, which is the part an auditor asks about.
    expect(rows[1]?.before).toEqual({ role: 'auditor' })
    expect(rows[1]?.after).toEqual({ role: 'bookkeeper' })
  })
})
