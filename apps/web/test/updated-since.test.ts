import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import {
  handleCreateContact,
  handleListContacts,
  handleUpdateContact,
} from '../src/api/handlers/sales.js'
import { contactsQuery, createContactBody, updateContactBody } from '../src/api/schemas.js'

/**
 * Incremental sync on the lists whose rows change in place (spec 10.2, ADR
 * 0053).
 *
 * The column these read has existed since M1 and has never meant anything:
 * the shared `timestamps` builder set it on insert and nothing ever bumped it,
 * so `updated_at` equalled `created_at` forever. A filter built on that would
 * have returned nothing for rows that had in fact changed — the worst kind of
 * wrong, because the response is a success and the row is simply absent.
 * Migration 0029 puts a trigger on it. These tests are mostly about the
 * trigger.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let token: string

const contextFor = async () =>
  resolveRequestContext({
    database,
    request: new Request('https://klopt.test/api/v1/contacts', {
      headers: new Headers({
        authorization: `Bearer ${token}`,
        'idempotency-key': crypto.randomUUID(),
      }),
    }),
  })

const listedSince = async (updatedSince: string | null) =>
  (
    await handleListContacts(
      await contextFor(),
      contactsQuery.parse(updatedSince === null ? {} : { updatedSince }),
    )
  ).body.contacts

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
  const entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)

  token = (
    await issueToken(database, {
      entityId,
      name: 'updated-since-test',
      permissions: ['ledger:read', 'ledger:configure'],
      actorKind: 'script',
      actorId: 'updated-since-test',
    })
  ).token
}, 60_000)

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('what has changed since I last looked', () => {
  it('moves a row into the window when it is edited', async () => {
    const created = await handleCreateContact(
      await contextFor(),
      createContactBody.parse({ number: `SYNC-${crypto.randomUUID().slice(0, 8)}`, name: 'Quiet' }),
    )
    const id = (created.body as { id: string }).id

    // A mirror that has just caught up: it takes the newest `updatedAt` it saw
    // and asks for everything at or after it next time.
    const watermark = new Date(Date.now() + 1).toISOString()
    expect((await listedSince(watermark)).map((row) => row.id)).not.toContain(id)

    await handleUpdateContact(await contextFor(), id, updateContactBody.parse({ name: 'Noisy' }))

    const moved = await listedSince(watermark)
    expect(moved.map((row) => row.id)).toContain(id)
    expect(moved.find((row) => row.id === id)?.name).toBe('Noisy')
  })

  it('hands back the value to resume from', async () => {
    // Without this the filter is unusable: a client has nothing to pass next
    // time except its own clock, which is not the clock that wrote the row.
    const rows = await listedSince(null)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.updatedAt).toEqual(expect.any(String))
  })

  it('is inclusive, so resuming from the newest row overlaps rather than skips', async () => {
    const created = await handleCreateContact(
      await contextFor(),
      createContactBody.parse({ number: `EDGE-${crypto.randomUUID().slice(0, 8)}`, name: 'Edge' }),
    )
    const id = (created.body as { id: string }).id
    const mine = (await listedSince(null)).find((row) => row.id === id)
    expect(mine).toBeDefined()

    // Asking from exactly its own timestamp returns it again. One row of
    // overlap that a client deduplicates by id, rather than a row it never
    // sees because the comparison was strict.
    expect((await listedSince(mine!.updatedAt)).map((row) => row.id)).toContain(id)
  })

  it('refuses a cursor that is not a timestamp', () => {
    // A client sending a bare date, or the string "undefined", should be told
    // rather than quietly handed the whole table.
    expect(contactsQuery.safeParse({ updatedSince: '2026-01-01' }).success).toBe(false)
    expect(contactsQuery.safeParse({ updatedSince: 'undefined' }).success).toBe(false)
    expect(contactsQuery.safeParse({ updatedSince: '2026-01-01T00:00:00Z' }).success).toBe(true)
  })

  it('leaves the list alone when no cursor is given', async () => {
    const all = await listedSince(null)
    const explicit = (
      await handleListContacts(await contextFor(), contactsQuery.parse({ customersOnly: 'false' }))
    ).body.contacts
    expect(all.length).toBe(explicit.length)
  })
})
