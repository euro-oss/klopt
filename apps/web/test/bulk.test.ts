import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { handleListJournalEntries, handlePostJournalEntries } from '../src/api/handlers/ledger.js'
import { listEntriesQuery, postJournalEntriesBody } from '../src/api/schemas.js'

/**
 * Import-shaped posting (spec 10.2, ADR 0054).
 *
 * > Bulk endpoints for import-shaped work, with per-item results rather than
 * > all-or-nothing.
 *
 * The requirement is about transactions, not about the response shape, and the
 * test that matters is the third one: a bad entry in the middle must not take
 * the good ones with it. An importer with one wrong row out of ten thousand
 * should fix that row, not start again.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let token: string

const contextFor = async (idempotencyKey: string) =>
  resolveRequestContext({
    database,
    request: new Request('https://klopt.test/api/v1/journal-entries/batch', {
      headers: new Headers({
        authorization: `Bearer ${token}`,
        'idempotency-key': idempotencyKey,
      }),
    }),
  })

const entry = (description: string, accountNumber = '1300') => ({
  journalCode: 'MEM',
  bookingDate: '2026-03-15',
  documentDate: '2026-03-15',
  description,
  lines: [
    { accountNumber, debit: '10000' },
    { accountNumber: '8000', credit: '10000' },
  ],
})

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
  const entityId = await seedEntity(database)

  token = (
    await issueToken(database, {
      entityId,
      name: 'bulk-test',
      permissions: ['ledger:read', 'ledger:post'],
      actorKind: 'script',
      actorId: 'bulk-test',
    })
  ).token
}, 60_000)

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('posting a batch', () => {
  it('posts every entry and reports each one', async () => {
    const key = crypto.randomUUID()
    const result = await handlePostJournalEntries(
      await contextFor(key),
      postJournalEntriesBody.parse({
        entries: [entry('Batch one'), entry('Batch two'), entry('Batch three')],
      }),
    )

    expect(result.body.posted).toBe(3)
    expect(result.body.failed).toBe(0)
    expect(result.body.results).toHaveLength(3)
    expect(result.body.results.map((item) => item.index)).toEqual([0, 1, 2])
    for (const item of result.body.results) {
      expect(item.status).toBe('posted')
      expect(item.entry?.id).toEqual(expect.any(String))
      expect(item.problem).toBeNull()
    }

    // Three distinct entries, not one written three times.
    const ids = new Set(result.body.results.map((item) => item.entry?.id))
    expect(ids.size).toBe(3)
  })

  it('keeps the good entries when one in the middle is refused', async () => {
    /**
     * The requirement, stated as a test. `9999` is not in the chart, so entry
     * 1 cannot post — and entries 0 and 2 must be in the books regardless,
     * because each is its own transaction.
     */
    const result = await handlePostJournalEntries(
      await contextFor(crypto.randomUUID()),
      postJournalEntriesBody.parse({
        entries: [entry('Good before'), entry('Bad middle', '7777'), entry('Good after')],
      }),
    )

    expect(result.body.posted).toBe(2)
    expect(result.body.failed).toBe(1)
    expect(result.body.results[1]?.status).toBe('failed')
    expect(result.body.results[1]?.problem?.code).toBe('validation_failed')
    // Which entry, and which field of it — an importer fixes a row with this.
    expect(result.body.results[1]?.problem?.violations[0]?.code).toBe('unknown_account')

    const listed = await handleListJournalEntries(
      await contextFor(crypto.randomUUID()),
      listEntriesQuery.parse({ limit: '100' }),
    )
    const descriptions = listed.body.entries.map((row) => row.description)
    expect(descriptions).toContain('Good before')
    expect(descriptions).toContain('Good after')
    expect(descriptions).not.toContain('Bad middle')
  })

  it('replays rather than double-posting when the batch is retried', async () => {
    // The failure this prevents is an importer whose connection dropped
    // retrying, and every entry landing twice.
    const key = crypto.randomUUID()
    const body = postJournalEntriesBody.parse({ entries: [entry('Once'), entry('Twice')] })

    const first = await handlePostJournalEntries(await contextFor(key), body)
    const again = await handlePostJournalEntries(await contextFor(key), body)

    expect(first.body.posted).toBe(2)
    expect(again.body.posted).toBe(0)
    expect(again.body.replayed).toBe(2)
    expect(again.body.results.map((item) => item.entry?.id)).toEqual(
      first.body.results.map((item) => item.entry?.id),
    )
  })

  it('treats two identical entries in one batch as two entries', async () => {
    // The key is derived from the index, not the content. Hashing the content
    // would silently merge a genuine pair of identical postings — two
    // identical expense claims in one import are two claims.
    const result = await handlePostJournalEntries(
      await contextFor(crypto.randomUUID()),
      postJournalEntriesBody.parse({ entries: [entry('Same'), entry('Same')] }),
    )

    expect(result.body.posted).toBe(2)
    expect(new Set(result.body.results.map((item) => item.entry?.id)).size).toBe(2)
  })

  it('commits nothing on a dry run, and still reports per item', async () => {
    const result = await handlePostJournalEntries(
      await contextFor(crypto.randomUUID()),
      postJournalEntriesBody.parse({
        entries: [entry('Dry good'), entry('Dry bad', '7777')],
        dryRun: true,
      }),
    )

    expect(result.body.dryRun).toBe(true)
    expect(result.body.failed).toBe(1)

    const listed = await handleListJournalEntries(
      await contextFor(crypto.randomUUID()),
      listEntriesQuery.parse({ limit: '100' }),
    )
    expect(listed.body.entries.map((row) => row.description)).not.toContain('Dry good')
  })

  it('refuses a batch larger than it will promise to finish', () => {
    const entries = Array.from({ length: 501 }, (_, index) => entry(`Too many ${String(index)}`))
    expect(postJournalEntriesBody.safeParse({ entries }).success).toBe(false)
    expect(postJournalEntriesBody.safeParse({ entries: [] }).success).toBe(false)
  })
})
