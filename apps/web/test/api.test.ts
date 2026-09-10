import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { ApiError } from '../src/api/errors.js'
import {
  handleGetJournalEntry,
  handleGetTrialBalance,
  handleListAccounts,
  handleListJournalEntries,
  handlePostJournalEntry,
  handleReverseJournalEntry,
  handleVerifyChain,
} from '../src/api/handlers/ledger.js'
import { postJournalEntryBody, trialBalanceQuery } from '../src/api/schemas.js'

/**
 * The API, end to end against a real database, one layer below HTTP.
 *
 * The route files are three lines each — parse, call a handler, serialise — so
 * testing the handlers with a context resolved from a real `Request` covers
 * everything that has a decision in it, without booting a server for each case.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let entityId: string
let writeToken: string
let readToken: string

function request(
  token: string | null,
  init: { idempotencyKey?: string; url?: string } = {},
): Request {
  const headers = new Headers()
  if (token !== null) headers.set('authorization', `Bearer ${token}`)
  if (init.idempotencyKey !== undefined) headers.set('idempotency-key', init.idempotencyKey)
  return new Request(init.url ?? 'https://klopt.test/api/v1/journal-entries', { headers })
}

async function contextFor(token: string, idempotencyKey?: string) {
  return resolveRequestContext({
    database,
    request: request(token, idempotencyKey === undefined ? {} : { idempotencyKey }),
  })
}

const entryBody = (overrides: Record<string, unknown> = {}) =>
  postJournalEntryBody.parse({
    journalCode: 'MEM',
    bookingDate: '2026-03-15',
    documentDate: '2026-03-15',
    description: 'Verkoopfactuur 2026-001',
    lines: [
      { accountNumber: '1300', debit: '12100' },
      { accountNumber: '8000', credit: '10000' },
      { accountNumber: '1500', credit: '2100' },
    ],
    ...overrides,
  })

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  entityId = await seedEntity(database)

  writeToken = (
    await issueToken(database, {
      entityId,
      name: 'test-write',
      permissions: ['ledger:read', 'ledger:post'],
      actorKind: 'script',
      actorId: 'integration-test',
    })
  ).token

  readToken = (
    await issueToken(database, {
      entityId,
      name: 'test-read',
      permissions: ['ledger:read'],
      actorKind: 'human',
      actorId: 'accountant',
    })
  ).token
}, 60_000)

afterAll(async () => {
  // Take away the fixtures that would otherwise keep the worker busy.
  await cleanupSeededBackgroundWork(database)
  await closeDatabase(database)
})

describe('authentication', () => {
  it('refuses a request with no token', async () => {
    await expect(resolveRequestContext({ database, request: request(null) })).rejects.toMatchObject(
      { code: 'unauthenticated', status: 401 },
    )
  })

  it('refuses an unknown token', async () => {
    await expect(
      resolveRequestContext({ database, request: request('klopt_not-a-real-token') }),
    ).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('refuses an expired token', async () => {
    const expired = await issueToken(database, {
      entityId,
      name: 'expired',
      permissions: ['ledger:read'],
      actorKind: 'script',
      actorId: 'old',
      expiresAt: new Date(Date.now() - 1000),
    })

    await expect(
      resolveRequestContext({ database, request: request(expired.token) }),
    ).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('takes the entity from the token, not from the caller', async () => {
    const context = await contextFor(readToken)
    expect(context.entityId).toBe(entityId)
  })

  it('carries the actor kind through, so the audit log can tell an agent apart', async () => {
    const agent = await issueToken(database, {
      entityId,
      name: 'agent',
      permissions: ['ledger:read'],
      actorKind: 'agent',
      actorId: 'assistant-1',
      principalId: 'user-42',
    })

    const context = await resolveRequestContext({ database, request: request(agent.token) })
    expect(context.actor).toEqual({ kind: 'agent', id: 'assistant-1', principalId: 'user-42' })
  })
})

describe('permissions', () => {
  it('refuses a write with a read-only token', async () => {
    const context = await contextFor(readToken, uuidv7())
    await expect(handlePostJournalEntry(context, entryBody())).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    })
  })

  it('allows a read with a read-only token', async () => {
    const context = await contextFor(readToken)
    const result = await handleListAccounts(context)
    expect(result.status).toBe(200)
    expect(result.body.accounts.length).toBeGreaterThan(0)
  })
})

describe('posting over the API', () => {
  it('requires an idempotency key', async () => {
    const context = await contextFor(writeToken)
    await expect(handlePostJournalEntry(context, entryBody())).rejects.toMatchObject({
      code: 'idempotency_key_required',
    })
  })

  it('creates an entry and returns 201', async () => {
    const context = await contextFor(writeToken, uuidv7())
    const result = await handlePostJournalEntry(context, entryBody())

    expect(result.status).toBe(201)
    expect(result.body.replayed).toBe(false)
    expect(result.body.entry.lines).toHaveLength(3)
    // Money on the wire is a string, never a JSON number.
    expect(result.body.entry.lines[0]?.debit).toBe('12100')
    expect(typeof result.body.entry.chainSequence).toBe('string')
  })

  it('replays an idempotent retry with 200 and the same entry', async () => {
    const key = uuidv7()
    const first = await handlePostJournalEntry(await contextFor(writeToken, key), entryBody())
    const second = await handlePostJournalEntry(await contextFor(writeToken, key), entryBody())

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(second.body.replayed).toBe(true)
    expect(second.body.entry.id).toBe(first.body.entry.id)
  })

  it('commits nothing on a dry run', async () => {
    const context = await contextFor(writeToken, uuidv7())
    const result = await handlePostJournalEntry(context, entryBody({ dryRun: true }))

    expect(result.status).toBe(200)
    expect(result.body.dryRun).toBe(true)

    await expect(
      handleGetJournalEntry(await contextFor(readToken), result.body.entry.id),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('returns the violations, not just a status code', async () => {
    const context = await contextFor(writeToken, uuidv7())
    const error = await handlePostJournalEntry(
      context,
      entryBody({
        lines: [
          { accountNumber: '1300', debit: '12100' },
          { accountNumber: '8000', credit: '9000' },
        ],
      }),
    ).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ name: 'LedgerError' })
    expect((error as { violations: { code: string }[] }).violations[0]?.code).toBe(
      'entry_unbalanced',
    )
  })

  it('rejects a body the schema does not accept, naming the field', () => {
    const parsed = postJournalEntryBody.safeParse({
      journalCode: 'MEM',
      bookingDate: '15-03-2026',
      documentDate: '2026-03-15',
      description: 'Wrong date format',
      lines: [{ accountNumber: '1300', debit: '1' }],
    })

    expect(parsed.success).toBe(false)
    const paths = parsed.error?.issues.map((issue) => issue.path.join('.')) ?? []
    expect(paths).toContain('bookingDate')
    expect(paths).toContain('lines')
  })

  it('refuses an amount sent as a JSON number', () => {
    // Money crosses the boundary as a string. A number would already have been
    // rounded by the time it reached us.
    const parsed = postJournalEntryBody.safeParse({
      journalCode: 'MEM',
      bookingDate: '2026-03-15',
      documentDate: '2026-03-15',
      description: 'Numeric amount',
      lines: [
        { accountNumber: '1300', debit: 12100 },
        { accountNumber: '8000', credit: '12100' },
      ],
    })

    expect(parsed.success).toBe(false)
  })
})

describe('reversal', () => {
  it('posts a reversal and links it to the original', async () => {
    const original = await handlePostJournalEntry(
      await contextFor(writeToken, uuidv7()),
      entryBody(),
    )

    const reversal = await handleReverseJournalEntry(
      await contextFor(writeToken, uuidv7()),
      original.body.entry.id,
      { bookingDate: '2026-03-31', description: null, dryRun: false },
    )

    expect(reversal.status).toBe(201)
    expect(reversal.body.entry.reversesEntryId).toBe(original.body.entry.id)
    expect(reversal.body.entry.lines[0]?.credit).toBe(original.body.entry.lines[0]?.debit)
  })

  it('404s on an entry that does not exist', async () => {
    await expect(
      handleReverseJournalEntry(await contextFor(writeToken, uuidv7()), uuidv7(), {
        bookingDate: '2026-03-31',
        description: null,
        dryRun: false,
      }),
    ).rejects.toBeInstanceOf(ApiError)
  })
})

describe('reporting', () => {
  it('produces a trial balance that adds up', async () => {
    const scoped = await seedEntity(database)
    const token = (
      await issueToken(database, {
        entityId: scoped,
        name: 'scoped',
        permissions: ['ledger:read', 'ledger:post'],
        actorKind: 'script',
        actorId: 'reporting-test',
      })
    ).token

    for (let index = 0; index < 3; index += 1) {
      await handlePostJournalEntry(await contextFor(token, uuidv7()), entryBody())
    }

    const context = await contextFor(token)
    const result = await handleGetTrialBalance(
      context,
      trialBalanceQuery.parse({ fiscalYear: '2026' }),
    )

    expect(result.body.difference).toBe('0')
    expect(result.body.totalDebit).toBe('36300')
    expect(result.body.totalCredit).toBe('36300')

    const debtors = result.body.lines.find((line) => line.accountNumber === '1300')
    expect(debtors?.debit).toBe('36300')
    expect(debtors?.closingBalance).toBe('36300')
    expect(debtors?.rgsCode).toBe('BVorDeb')

    // Accounts with no movement are noise on a trial balance.
    expect(result.body.lines.some((line) => line.accountNumber === '0100')).toBe(false)
  })

  it('restricts the trial balance to the requested periods', async () => {
    const scoped = await seedEntity(database)
    const token = (
      await issueToken(database, {
        entityId: scoped,
        name: 'scoped',
        permissions: ['ledger:read', 'ledger:post'],
        actorKind: 'script',
        actorId: 'period-test',
      })
    ).token

    await handlePostJournalEntry(
      await contextFor(token, uuidv7()),
      entryBody({ bookingDate: '2026-02-10', documentDate: '2026-02-10' }),
    )
    await handlePostJournalEntry(
      await contextFor(token, uuidv7()),
      entryBody({ bookingDate: '2026-08-10', documentDate: '2026-08-10' }),
    )

    const context = await contextFor(token)
    const august = await handleGetTrialBalance(
      context,
      trialBalanceQuery.parse({ fiscalYear: '2026', fromPeriod: '8', toPeriod: '8' }),
    )

    const debtors = august.body.lines.find((line) => line.accountNumber === '1300')
    // February is the opening balance, August is the movement.
    expect(debtors?.openingBalance).toBe('12100')
    expect(debtors?.debit).toBe('12100')
    expect(debtors?.closingBalance).toBe('24200')
    expect(august.body.difference).toBe('0')
  })

  it('reports RGS coverage as a health metric', async () => {
    const result = await handleListAccounts(await contextFor(readToken))
    expect(result.body.rgsCoverage.total).toBe(14)
    // Every account in the fixture chart but 9999, which is deliberately
    // unmapped so coverage has something to report.
    expect(result.body.rgsCoverage.mapped).toBe(13)
  })

  it('paginates entries by cursor', async () => {
    const scoped = await seedEntity(database)
    const token = (
      await issueToken(database, {
        entityId: scoped,
        name: 'scoped',
        permissions: ['ledger:read', 'ledger:post'],
        actorKind: 'script',
        actorId: 'pagination-test',
      })
    ).token

    for (let index = 0; index < 5; index += 1) {
      await handlePostJournalEntry(await contextFor(token, uuidv7()), entryBody())
    }

    const first = await handleListJournalEntries(await contextFor(token), {
      cursor: null,
      limit: 2,
    })
    expect(first.body.entries).toHaveLength(2)
    expect(first.body.nextCursor).toBe('2')

    const second = await handleListJournalEntries(await contextFor(token), {
      cursor: first.body.nextCursor,
      limit: 2,
    })
    expect(second.body.entries.map((entry) => entry.chainSequence)).toEqual(['3', '4'])

    const last = await handleListJournalEntries(await contextFor(token), {
      cursor: '4',
      limit: 100,
    })
    expect(last.body.entries).toHaveLength(1)
    expect(last.body.nextCursor).toBeNull()
  })
})

describe('chain verification over the API', () => {
  it('publishes the head hash and reports no breaks', async () => {
    const scoped = await seedEntity(database)
    const token = (
      await issueToken(database, {
        entityId: scoped,
        name: 'scoped',
        permissions: ['ledger:read', 'ledger:post'],
        actorKind: 'script',
        actorId: 'chain-test',
      })
    ).token

    for (let index = 0; index < 4; index += 1) {
      await handlePostJournalEntry(await contextFor(token, uuidv7()), entryBody())
    }

    const result = await handleVerifyChain(await contextFor(token))

    expect(result.body.verified).toBe(true)
    expect(result.body.entryCount).toBe(4)
    expect(result.body.headHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.body.failures).toEqual([])
  })
})

describe('entity scoping', () => {
  it('cannot read another entity’s entry', async () => {
    const mine = await handlePostJournalEntry(await contextFor(writeToken, uuidv7()), entryBody())

    const otherEntity = await seedEntity(database)
    const otherToken = (
      await issueToken(database, {
        entityId: otherEntity,
        name: 'other',
        permissions: ['ledger:read'],
        actorKind: 'script',
        actorId: 'other',
      })
    ).token

    await expect(
      handleGetJournalEntry(await contextFor(otherToken), mine.body.entry.id),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})
