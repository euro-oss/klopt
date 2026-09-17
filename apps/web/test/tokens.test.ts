import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import {
  handleIssueToken,
  handleListTokens,
  handleRevokeOAuthClient,
  handleRevokeToken,
} from '../src/api/handlers/tokens.js'
import { issueTokenBody } from '../src/api/schemas.js'

/**
 * Issuing and revoking API tokens (spec 14).
 *
 * `tokens:manage` existed in the roles from the start and nothing used it, so
 * there was no way to make a token or take one back except by writing SQL —
 * while the README told people to do both under Toegang and the OAuth flow was
 * minting them on its own.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database

function request(token: string, key?: string): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (key !== undefined) headers.set('idempotency-key', key)
  return new Request('https://klopt.test/x', { headers })
}

const context = (token: string, key?: string) =>
  resolveRequestContext({ database, request: request(token, key) })

async function newEntity(permissions: readonly string[] = ['*']) {
  const entityId = await seedEntity(database)
  const { token } = await issueToken(database, {
    entityId,
    name: 'tokens-test',
    permissions: [...permissions],
    actorKind: 'human',
    actorId: `human-${entityId.slice(0, 8)}`,
  })
  return { entityId, token }
}

const body = (overrides: Record<string, unknown> = {}) =>
  issueTokenBody.parse({ name: 'export-script', permissions: ['ledger:read'], ...overrides })

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
}, 120_000)

afterAll(async () => {
  // Take away the fixtures that would otherwise keep the worker busy.
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('issuing', () => {
  it('returns the secret exactly once', async () => {
    const { token } = await newEntity()

    const issued = await handleIssueToken(await context(token, crypto.randomUUID()), body())
    expect(issued.status).toBe(201)
    expect(issued.body.token).toMatch(/^klopt_/)

    // And never again: only a hash is stored, so the list cannot return it even
    // if somebody added the column to the select.
    const listed = await handleListTokens(await context(token))
    const row = listed.body.tokens.find((candidate) => candidate.id === issued.body.id)
    expect(row).toBeDefined()
    expect(JSON.stringify(row)).not.toContain(issued.body.token)
  })

  it('will not mint a token more powerful than the person minting it', async () => {
    /**
     * Otherwise `tokens:manage` is an escalation: issue yourself a token with
     * `payments:approve`, present it back, and approve your own payment run —
     * which is the one thing the two-person rule exists to stop.
     */
    const { token } = await newEntity(['tokens:manage', 'ledger:read'])

    await expect(
      handleIssueToken(
        await context(token, crypto.randomUUID()),
        body({ permissions: ['payments:approve'] }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('needs an idempotency key, because it writes', async () => {
    const { token } = await newEntity()

    await expect(handleIssueToken(await context(token), body())).rejects.toMatchObject({
      code: 'idempotency_key_required',
    })
  })

  it('refuses somebody without tokens:manage', async () => {
    const { token } = await newEntity(['ledger:read'])

    await expect(handleListTokens(await context(token))).rejects.toMatchObject({
      code: 'forbidden',
    })
  })
})

describe('revoking', () => {
  it('stops the token working', async () => {
    const { token } = await newEntity()
    const issued = await handleIssueToken(await context(token, crypto.randomUUID()), body())

    // It works first.
    const before = await resolveRequestContext({ database, request: request(issued.body.token) })
    expect(before.entityId).toBeDefined()

    await handleRevokeToken(await context(token), issued.body.id)

    await expect(
      resolveRequestContext({ database, request: request(issued.body.token) }),
    ).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('says not_found for another administration’s token', async () => {
    // Not "forbidden": that would confirm the id exists, which is enough to
    // enumerate another administration's tokens by watching the status.
    const mine = await newEntity()
    const theirs = await newEntity()
    const issued = await handleIssueToken(await context(theirs.token, crypto.randomUUID()), body())

    await expect(
      handleRevokeToken(await context(mine.token), issued.body.id),
    ).rejects.toMatchObject({ code: 'not_found' })

    // And theirs still works.
    const still = await resolveRequestContext({ database, request: request(issued.body.token) })
    expect(still.entityId).toBe(theirs.entityId)
  })

  it('reports a token that is already gone as not_found', async () => {
    const { token } = await newEntity()
    const issued = await handleIssueToken(await context(token, crypto.randomUUID()), body())

    await handleRevokeToken(await context(token), issued.body.id)
    await expect(handleRevokeToken(await context(token), issued.body.id)).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})

describe('withdrawing an authorised app', () => {
  it('refuses when this administration never authorised it', async () => {
    // A client id is global. Deleting a registration on nothing but a URL
    // parameter would let any administration unregister an app another one is
    // relying on.
    const { token } = await newEntity()

    await expect(
      handleRevokeOAuthClient(await context(token), 'klopt_c_someone_elses'),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})
