import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import {
  closeDatabase,
  createAuth,
  createDatabase,
  membershipsFor,
  runMigrations,
  type Auth,
  type Database,
} from '@klopt/db'
import { readAuditLog, seedEntity, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { createMemoryEmailTransport } from '@klopt/adapters'
import { resolveRequestContext, resolveSetupContext } from '../src/api/auth.js'
import { setAuthForTest } from '../src/api/auth-instance.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { setEmailTransportForTest } from '../src/api/email.js'
import { ApiError } from '../src/api/errors.js'
import { handleListAuditLog } from '../src/api/handlers/audit.js'
import { handleGetEntity, handleCreateEntity } from '../src/api/handlers/setup.js'
import {
  handleInviteMember,
  handleListMembers,
  handleRemoveMember,
  handleSetMemberRole,
} from '../src/api/handlers/members.js'
import { handleIssueToken, handleListTokens } from '../src/api/handlers/tokens.js'
import {
  auditLogQuery,
  createEntityBody,
  inviteMemberBody,
  issueTokenBody,
  setMemberRoleBody,
} from '../src/api/schemas.js'

/**
 * Closed signup = invite-only sign-in, and entity creation only for
 * KLOPT_INSTANCE_ADMINS (#47).
 *
 * Covers the invite OTP acceptance criteria, the instance-admin create gate,
 * and the product rule that an invited Eigenaar of one administration stays
 * scoped to that administration — read, export, invite, tokens, OAuth/MCP
 * grant surface, and instance settings.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let auth: Auth

const mailbox = createMemoryEmailTransport()
const invitations = createMemoryEmailTransport()

const SECRET = 'test-secret-not-for-production-0123456789'
const BASE = 'https://klopt.test'

function closedAuth(): Auth {
  return createAuth({
    database,
    secret: SECRET,
    baseUrl: BASE,
    email: mailbox,
    disableSignUp: true,
    disableRateLimit: true,
  })
}

function openAuth(): Auth {
  return createAuth({
    database,
    secret: SECRET,
    baseUrl: BASE,
    email: mailbox,
    disableRateLimit: true,
  })
}

async function otpFor(email: string): Promise<string | null> {
  const before = mailbox.sent.length
  await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })
  const delivered = mailbox.sent.slice(before).find((message) => message.to === email)
  if (delivered === undefined) return null
  return /\b(\d{6})\b/.exec(delivered.text)?.[1] ?? null
}

async function signIn(
  email: string,
): Promise<{ userId: string; cookie: string } | { refused: true; status: number }> {
  const otp = await otpFor(email)
  if (otp === null) return { refused: true, status: 0 }

  try {
    const response = await auth.api.signInEmailOTP({
      body: { email, otp },
      asResponse: true,
    })
    if (!response.ok) return { refused: true, status: response.status }
    const setCookie = response.headers.get('set-cookie')
    if (setCookie === null) return { refused: true, status: response.status }
    const body = (await response.json()) as { user: { id: string } }
    return { userId: body.user.id, cookie: setCookie.split(';')[0]! }
  } catch {
    return { refused: true, status: 400 }
  }
}

const request = (headers: Record<string, string>): Request =>
  new Request(`${BASE}/api/v1/x`, { headers: new Headers(headers) })

/** Bootstrap an owner + administration while signup is still open. */
async function bootstrapOwner(name: string): Promise<{
  email: string
  userId: string
  cookie: string
  entityId: string
}> {
  auth = openAuth()
  setAuthForTest(auth)
  const email = `owner-${randomUUID()}@example.test`
  const signed = await signIn(email)
  if ('refused' in signed) throw new Error(`Could not bootstrap ${email}`)
  const entityId = uuidv7()
  await handleCreateEntity(
    await resolveSetupContext({ database, request: request({ cookie: signed.cookie }) }),
    entityId,
    createEntityBody.parse({ name, firstFiscalYear: '2026' }),
  )
  return { email, userId: signed.userId, cookie: signed.cookie, entityId }
}

function setClosedEnv(admins: string): void {
  process.env['KLOPT_SIGNUP'] = 'closed'
  process.env['KLOPT_INSTANCE_ADMINS'] = admins
}

function clearClosedEnv(): void {
  delete process.env['KLOPT_SIGNUP']
  delete process.env['KLOPT_INSTANCE_ADMINS']
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
  setEmailTransportForTest(invitations)
  auth = closedAuth()
  setAuthForTest(auth)
}, 60_000)

afterEach(() => {
  mailbox.sent.length = 0
  invitations.sent.length = 0
  clearClosedEnv()
  auth = closedAuth()
  setAuthForTest(auth)
})

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  clearClosedEnv()
  setAuthForTest(null)
  setDatabaseForTest(null)
  setEmailTransportForTest(null)
  await closeDatabase(database)
})

describe('invite-only OTP when KLOPT_SIGNUP=closed', () => {
  it('sends a code to a live-invited address, signs them in, claims the role and audits', async () => {
    const owner = await bootstrapOwner('InviteOnly BV')
    setClosedEnv(owner.email)
    auth = closedAuth()
    setAuthForTest(auth)

    // Re-sign the owner under the closed auth (same secret → same cookie shape).
    const ownerAgain = await signIn(owner.email)
    if ('refused' in ownerAgain) throw new Error('Owner could not re-sign in when closed')
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: ownerAgain.cookie }),
    })

    const invitee = `new-${randomUUID()}@example.nl`
    const invited = await handleInviteMember(
      context,
      inviteMemberBody.parse({ email: invitee, role: 'accountant' }),
    )
    expect(invited.status).toBe(201)

    const beforeMails = mailbox.sent.length
    const send = await auth.api.sendVerificationOTP({
      body: { email: invitee, type: 'sign-in' },
      asResponse: true,
    })
    expect(send.status).toBe(200)
    expect(await send.json()).toEqual({ success: true })
    expect(mailbox.sent.length).toBeGreaterThan(beforeMails)

    const otp = /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)?.[1]
    expect(otp).toBeDefined()

    const signed = await auth.api.signInEmailOTP({
      body: { email: invitee, otp: otp! },
      asResponse: true,
    })
    expect(signed.ok).toBe(true)
    const body = (await signed.json()) as { user: { id: string } }

    expect(await membershipsFor(database, body.user.id)).toEqual([
      { entityId: owner.entityId, entityName: 'InviteOnly BV', role: 'accountant' },
    ])

    const list = await handleListMembers(context)
    expect(list.body.invitations).toEqual([])
    expect(list.body.members.some((member) => member.email === invitee)).toBe(true)

    const audit = await readAuditLog(database, owner.entityId, 'entity_member')
    expect(audit.some((row) => row.action === 'members.acceptInvitation')).toBe(true)
  })

  it('sends nothing to an uninvited address; response matches the invited send; sign-in refused', async () => {
    const owner = await bootstrapOwner('Silent BV')
    setClosedEnv(owner.email)
    auth = closedAuth()
    setAuthForTest(auth)

    const ownerAgain = await signIn(owner.email)
    if ('refused' in ownerAgain) throw new Error('Owner could not re-sign in')
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: ownerAgain.cookie }),
    })

    const invited = `invited-${randomUUID()}@example.nl`
    const stranger = `stranger-${randomUUID()}@example.nl`
    await handleInviteMember(
      context,
      inviteMemberBody.parse({ email: invited, role: 'bookkeeper' }),
    )

    mailbox.sent.length = 0
    const invitedSend = await auth.api.sendVerificationOTP({
      body: { email: invited, type: 'sign-in' },
      asResponse: true,
    })
    const invitedBody = (await invitedSend.json()) as { success: boolean }
    const invitedMails = mailbox.sent.length

    const strangerSend = await auth.api.sendVerificationOTP({
      body: { email: stranger, type: 'sign-in' },
      asResponse: true,
    })
    const strangerBody = (await strangerSend.json()) as { success: boolean }

    expect(invitedSend.status).toBe(strangerSend.status)
    expect(invitedBody).toEqual(strangerBody)
    expect(invitedBody).toEqual({ success: true })
    // A code went to the invitee; none to the stranger.
    expect(invitedMails).toBe(1)
    expect(mailbox.sent.length).toBe(1)

    await expect(
      auth.api.signInEmailOTP({ body: { email: stranger, otp: '000000' } }),
    ).rejects.toThrow()
  })

  it('treats an expired invitation as no invitation', async () => {
    const owner = await bootstrapOwner('Expired BV')
    setClosedEnv(owner.email)
    auth = closedAuth()
    setAuthForTest(auth)

    const ownerAgain = await signIn(owner.email)
    if ('refused' in ownerAgain) throw new Error('Owner could not re-sign in')
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: ownerAgain.cookie }),
    })

    const invitee = `expired-${randomUUID()}@example.nl`
    await handleInviteMember(context, inviteMemberBody.parse({ email: invitee, role: 'auditor' }))

    await database.execute(
      `update klopt.entity_invitations set expires_at = now() - interval '1 day' where email = '${invitee.replace(/'/g, "''")}'`,
    )

    mailbox.sent.length = 0
    await auth.api.sendVerificationOTP({ body: { email: invitee, type: 'sign-in' } })
    expect(mailbox.sent).toHaveLength(0)

    await expect(
      auth.api.signInEmailOTP({ body: { email: invitee, otp: '123456' } }),
    ).rejects.toThrow()
  })

  it('treats a revoked invitation as no invitation', async () => {
    const owner = await bootstrapOwner('Revoked BV')
    setClosedEnv(owner.email)
    auth = closedAuth()
    setAuthForTest(auth)

    const ownerAgain = await signIn(owner.email)
    if ('refused' in ownerAgain) throw new Error('Owner could not re-sign in')
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: ownerAgain.cookie }),
    })

    const invitee = `revoked-${randomUUID()}@example.nl`
    await handleInviteMember(
      context,
      inviteMemberBody.parse({ email: invitee, role: 'bookkeeper' }),
    )
    const list = await handleListMembers(context)
    await handleRemoveMember(context, list.body.invitations[0]!.invitationId)

    mailbox.sent.length = 0
    await auth.api.sendVerificationOTP({ body: { email: invitee, type: 'sign-in' } })
    expect(mailbox.sent).toHaveLength(0)
  })
})

describe('entity:create when signup is closed', () => {
  it('allows an instance admin to create an administration', async () => {
    const admin = await bootstrapOwner('Admin Firm')
    setClosedEnv(admin.email)
    auth = closedAuth()
    setAuthForTest(auth)

    const again = await signIn(admin.email)
    if ('refused' in again) throw new Error('Admin could not sign in')

    const context = await resolveSetupContext({
      database,
      request: request({ cookie: again.cookie }),
    })
    expect(context.permissions.has('entity:create')).toBe(true)

    const created = await handleCreateEntity(
      context,
      uuidv7(),
      createEntityBody.parse({ name: 'Second Admin Books', firstFiscalYear: '2026' }),
    )
    expect(created.status).toBe(201)
  })

  it('refuses an Eigenaar of another entity who is not an instance admin', async () => {
    const admin = await bootstrapOwner('Gate Admin')
    const other = await bootstrapOwner('Other Eigenaar')
    setClosedEnv(admin.email)
    auth = closedAuth()
    setAuthForTest(auth)

    const again = await signIn(other.email)
    if ('refused' in again) throw new Error('Eigenaar could not sign in')

    await expect(
      resolveSetupContext({ database, request: request({ cookie: again.cookie }) }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === 'forbidden' &&
        /instance admin/i.test(error.message),
    )
  })

  it('refuses an unlisted member when closed', async () => {
    const admin = await bootstrapOwner('Listed Admin')
    setClosedEnv(admin.email)
    auth = closedAuth()
    setAuthForTest(auth)

    const again = await signIn(admin.email)
    if ('refused' in again) throw new Error('Admin could not sign in')
    const context = await resolveRequestContext({
      database,
      request: request({ cookie: again.cookie }),
    })
    const member = `member-${randomUUID()}@example.test`
    await handleInviteMember(context, inviteMemberBody.parse({ email: member, role: 'bookkeeper' }))

    const joined = await signIn(member)
    if ('refused' in joined) throw new Error('Invitee could not sign in')

    await expect(
      resolveSetupContext({ database, request: request({ cookie: joined.cookie }) }),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('refuses everyone when KLOPT_INSTANCE_ADMINS is empty', async () => {
    const owner = await bootstrapOwner('Empty Admins')
    setClosedEnv('')
    auth = closedAuth()
    setAuthForTest(auth)

    const again = await signIn(owner.email)
    if ('refused' in again) throw new Error('Owner could not sign in')

    await expect(
      resolveSetupContext({ database, request: request({ cookie: again.cookie }) }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('invited Eigenaar of B stays scoped to B', () => {
  /**
   * Trial shape: instance holds A and B; invitee is Eigenaar of B only.
   * They must not reach A (read, export, invite, tokens, OAuth/MCP grant
   * surface, audit) and must not create administrations.
   */
  async function eigenaarOfBOnly(): Promise<{
    entityA: string
    entityB: string
    cookieB: string
    emailB: string
    userIdB: string
    adminCookie: string
  }> {
    const admin = await bootstrapOwner('Entity A Holding')
    const entityA = admin.entityId

    setClosedEnv(admin.email)
    auth = closedAuth()
    setAuthForTest(auth)

    const adminAgain = await signIn(admin.email)
    if ('refused' in adminAgain) throw new Error('Admin could not sign in')

    // Admin creates B, then invites the trial Eigenaar into B only.
    const entityB = uuidv7()
    await handleCreateEntity(
      await resolveSetupContext({
        database,
        request: request({ cookie: adminAgain.cookie }),
      }),
      entityB,
      createEntityBody.parse({ name: 'Demo B', firstFiscalYear: '2026' }),
    )

    // Switch session to B to invite.
    const { setActiveEntity } = await import('@klopt/db')
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: adminAgain.cookie }),
    })
    await setActiveEntity(database, session!.session.token, entityB)

    const onB = await resolveRequestContext({
      database,
      request: request({ cookie: adminAgain.cookie }),
    })
    expect(onB.entityId).toBe(entityB)

    const emailB = `eigenaar-b-${randomUUID()}@example.nl`
    await handleInviteMember(onB, inviteMemberBody.parse({ email: emailB, role: 'owner' }))

    const joined = await signIn(emailB)
    if ('refused' in joined) throw new Error('Eigenaar of B could not sign in')

    expect(await membershipsFor(database, joined.userId)).toEqual([
      { entityId: entityB, entityName: 'Demo B', role: 'owner' },
    ])

    return {
      entityA,
      entityB,
      cookieB: joined.cookie,
      emailB,
      userIdB: joined.userId,
      adminCookie: adminAgain.cookie,
    }
  }

  it('cannot read entity A (not_found, not forbidden)', async () => {
    const { entityA, cookieB } = await eigenaarOfBOnly()
    await expect(
      resolveRequestContext({
        database,
        request: request({ cookie: cookieB }),
        entityId: entityA,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('cannot export entity A — context for A is not_found before any export runs', async () => {
    const { entityA, cookieB } = await eigenaarOfBOnly()
    // Export, audit-file and snapshots all require a RequestContext for A;
    // without membership the resolver refuses with not_found (not forbidden).
    await expect(
      resolveRequestContext({
        database,
        request: request({ cookie: cookieB }),
        entityId: entityA,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('cannot invite into entity A or change roles there', async () => {
    const { entityA, cookieB } = await eigenaarOfBOnly()
    await expect(
      resolveRequestContext({
        database,
        request: request({ cookie: cookieB }),
        entityId: entityA,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })

    // Same refusal is what invite / setRole would hit — they never see A's id.
    await expect(
      (async () => {
        const context = await resolveRequestContext({
          database,
          request: request({ cookie: cookieB }),
          entityId: entityA,
        })
        await handleInviteMember(
          context,
          inviteMemberBody.parse({ email: `x-${randomUUID()}@example.nl`, role: 'bookkeeper' }),
        )
      })(),
    ).rejects.toMatchObject({ code: 'not_found' })

    await expect(
      (async () => {
        const context = await resolveRequestContext({
          database,
          request: request({ cookie: cookieB }),
          entityId: entityA,
        })
        await handleSetMemberRole(context, uuidv7(), setMemberRoleBody.parse({ role: 'auditor' }))
      })(),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('cannot issue API tokens for entity A; tokens they issue are bound to B', async () => {
    const { entityA, entityB, cookieB } = await eigenaarOfBOnly()

    await expect(
      (async () => {
        const context = await resolveRequestContext({
          database,
          request: request({ cookie: cookieB, 'idempotency-key': uuidv7() }),
          entityId: entityA,
        })
        await handleIssueToken(
          context,
          issueTokenBody.parse({ name: 'leak', permissions: ['ledger:read'] }),
        )
      })(),
    ).rejects.toMatchObject({ code: 'not_found' })

    const onB = await resolveRequestContext({
      database,
      request: request({ cookie: cookieB, 'idempotency-key': uuidv7() }),
    })
    expect(onB.entityId).toBe(entityB)
    const issued = await handleIssueToken(
      onB,
      issueTokenBody.parse({ name: 'b-only', permissions: ['ledger:read'] }),
    )
    expect(issued.status).toBe(201)

    // Bearer tokens ignore entityId overrides and stay on the entity they were
    // minted for — so a B token cannot be pointed at A.
    const asToken = await resolveRequestContext({
      database,
      request: request({ authorization: `Bearer ${issued.body.token}` }),
      entityId: entityA,
    })
    expect(asToken.entityId).toBe(entityB)
  })

  it('cannot grant MCP/OAuth for entity A — consent only lists B', async () => {
    const { entityA, entityB, userIdB } = await eigenaarOfBOnly()
    const memberships = await membershipsFor(database, userIdB)
    expect(memberships.map((m) => m.entityId)).toEqual([entityB])
    expect(memberships.some((m) => m.entityId === entityA)).toBe(false)
    // approveAuthorizationRequest rejects any entityId not in this list
    // (apps/web/src/server/oauth.ts); the picker never offers A.
  })

  it('cannot create administrations or reach A’s audit log / entity settings / tokens', async () => {
    const { entityA, cookieB } = await eigenaarOfBOnly()

    // Instance settings /setup — refused (not an instance admin).
    await expect(
      resolveSetupContext({ database, request: request({ cookie: cookieB }) }),
    ).rejects.toMatchObject({ code: 'forbidden' })

    const denyA = () =>
      resolveRequestContext({
        database,
        request: request({ cookie: cookieB }),
        entityId: entityA,
      })

    await expect(denyA()).rejects.toMatchObject({ code: 'not_found' })
    await expect((async () => handleGetEntity(await denyA()))()).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(
      (async () => handleListAuditLog(await denyA(), auditLogQuery.parse({})))(),
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect((async () => handleListTokens(await denyA()))()).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('sees only B in the picker (membershipsFor)', async () => {
    // Also covers the session.test.ts extension asked for in the product AC.
    const other = await seedEntity(database)
    const { entityB, userIdB } = await eigenaarOfBOnly()
    const memberships = await membershipsFor(database, userIdB)
    expect(memberships).toHaveLength(1)
    expect(memberships[0]?.entityId).toBe(entityB)
    expect(memberships.some((m) => m.entityId === other)).toBe(false)
  })
})
