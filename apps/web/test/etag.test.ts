import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, createDatabase, issueToken, runMigrations, type Database } from '@klopt/db'
import { seedEntity, seedSalesConfiguration, cleanupSeededBackgroundWork } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { ApiError } from '../src/api/errors.js'
import { etagOf } from '../src/api/etag.js'
import { handleGetEntity, handleUpdateEntity } from '../src/api/handlers/setup.js'
import {
  handleCreateContact,
  handleGetContact,
  handleUpdateContact,
} from '../src/api/handlers/sales.js'
import { createContactBody, updateContactBody, updateEntityBody } from '../src/api/schemas.js'

/**
 * Optimistic concurrency on the two resources that can be edited in place
 * (spec 10.2, ADR 0052).
 *
 * The case this exists for is two people with the same form open. Without it
 * the second save wins silently and the first person never learns their change
 * is gone — which on a contact means an IBAN or a payment term, and those are
 * how money reaches the wrong account.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let entityId: string
let token: string

function contextFor(options: { ifMatch?: string; idempotencyKey?: string } = {}) {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (options.ifMatch !== undefined) headers.set('if-match', options.ifMatch)
  headers.set('idempotency-key', options.idempotencyKey ?? crypto.randomUUID())
  return resolveRequestContext({
    database,
    request: new Request('https://klopt.test/api/v1/contacts', { headers }),
  })
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
  entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)

  token = (
    await issueToken(database, {
      entityId,
      name: 'etag-test',
      permissions: ['ledger:read', 'ledger:configure'],
      actorKind: 'script',
      actorId: 'etag-test',
    })
  ).token
}, 60_000)

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

async function aContact(): Promise<{ id: string; etag: string }> {
  const created = await handleCreateContact(
    await contextFor(),
    createContactBody.parse({ number: `ETAG-${crypto.randomUUID().slice(0, 8)}`, name: 'Tag BV' }),
  )
  const id = (created.body as { id: string }).id
  const read = await handleGetContact(await contextFor(), id)
  return { id, etag: read.headers['etag'] }
}

describe('a contact carries a tag you can hold it to', () => {
  it('hands one out on the read', async () => {
    const { etag } = await aContact()
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/)
  })

  it('accepts an edit that quotes the current tag', async () => {
    const { id, etag } = await aContact()

    const updated = await handleUpdateContact(
      await contextFor({ ifMatch: etag }),
      id,
      updateContactBody.parse({ name: 'Tag Holding BV' }),
    )

    expect(updated.status).toBe(200)
  })

  it('refuses an edit quoting a tag somebody else has already moved', async () => {
    const { id, etag } = await aContact()

    // The first person saves. They had the same tag, and they get there first.
    await handleUpdateContact(
      await contextFor({ ifMatch: etag }),
      id,
      updateContactBody.parse({ name: 'First In' }),
    )

    // The second person is still holding the tag from before that.
    await expect(
      handleUpdateContact(
        await contextFor({ ifMatch: etag }),
        id,
        updateContactBody.parse({ name: 'Second In' }),
      ),
    ).rejects.toMatchObject({ code: 'precondition_failed' })

    // And the first person's change is the one that survived, which is the
    // whole point: the loser is told rather than the winner being arbitrary.
    const after = await handleGetContact(await contextFor(), id)
    expect((after.body as { contact: { name: string } }).contact.name).toBe('First In')
  })

  it('answers 412, which is the status a client branches on', async () => {
    const { id, etag } = await aContact()
    await handleUpdateContact(
      await contextFor({ ifMatch: etag }),
      id,
      updateContactBody.parse({ name: 'Moved' }),
    )

    try {
      await handleUpdateContact(
        await contextFor({ ifMatch: etag }),
        id,
        updateContactBody.parse({ name: 'Too Late' }),
      )
      expect.unreachable('it should have refused')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).status).toBe(412)
      // The current tag, so a client can retry without a second round trip.
      expect((error as ApiError).violations[0]?.message).toContain('"')
    }
  })

  it('lets an edit through when no tag is offered', async () => {
    // Optional on purpose: requiring it would be adding a required request
    // field, which v1 promised not to do. A caller who does not ask for the
    // check keeps the last-write-wins they already had.
    const { id } = await aContact()

    const updated = await handleUpdateContact(
      await contextFor(),
      id,
      updateContactBody.parse({ name: 'No Precondition' }),
    )

    expect(updated.status).toBe(200)
  })

  it('accepts `*`, which asks only that the thing still exists', async () => {
    const { id } = await aContact()
    const updated = await handleUpdateContact(
      await contextFor({ ifMatch: '*' }),
      id,
      updateContactBody.parse({ name: 'Any Version' }),
    )
    expect(updated.status).toBe(200)
  })

  it('does not move the tag when something unrelated changes', async () => {
    /**
     * The reason the tag is over the contact and not over the response.
     *
     * `GET /contacts/:id` reports how many invoices are open against them. If
     * the tag covered that, issuing an invoice in another room would refuse an
     * edit to a phone number — a precondition failing for something that has
     * nothing to do with the fields being edited.
     */
    const { id, etag } = await aContact()
    const body = (await handleGetContact(await contextFor(), id)).body as {
      contact: unknown
      openDocuments: unknown
    }

    expect(etagOf(body.contact)).toBe(etag)
    expect(etagOf(body)).not.toBe(etag)
  })
})

describe('the administration’s own settings carry one too', () => {
  it('refuses a stale edit and accepts a fresh one', async () => {
    const first = await handleGetEntity(await contextFor())
    const etag = first.headers['etag']

    await handleUpdateEntity(
      await contextFor({ ifMatch: etag }),
      updateEntityBody.parse({ name: 'Tagged BV' }),
    )

    await expect(
      handleUpdateEntity(
        await contextFor({ ifMatch: etag }),
        updateEntityBody.parse({ name: 'Stale BV' }),
      ),
    ).rejects.toMatchObject({ code: 'precondition_failed' })

    const after = await handleGetEntity(await contextFor())
    expect((after.body as { name: string }).name).toBe('Tagged BV')
    expect(after.headers['etag']).not.toBe(etag)
  })
})

describe('the tag itself', () => {
  it('does not depend on the order the object was built in', () => {
    // Two code paths that construct the same resource differently would
    // otherwise hash differently, and every edit would fail.
    expect(etagOf({ a: 1, b: 2 })).toBe(etagOf({ b: 2, a: 1 }))
  })

  it('ignores undefined, which JSON drops anyway', () => {
    expect(etagOf({ a: 1 })).toBe(etagOf({ a: 1, b: undefined }))
  })

  it('changes when a nested value changes', () => {
    expect(etagOf({ a: { b: 1 } })).not.toBe(etagOf({ a: { b: 2 } }))
  })

  it('tells null and absent apart, because the API does', () => {
    expect(etagOf({ a: null })).not.toBe(etagOf({}))
  })
})
