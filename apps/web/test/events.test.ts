import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EVENT_TYPES, uuidv7 } from '@klopt/core'
import {
  closeDatabase,
  createDatabase,
  issueToken,
  runMigrations,
  withSales,
  type Database,
} from '@klopt/db'
import { cleanupSeededBackgroundWork, seedEntity, seedSalesConfiguration } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { handleListEvents } from '../src/api/handlers/events.js'
import {
  handleCreateContact,
  handleDraftInvoice,
  handleIssueInvoice,
} from '../src/api/handlers/sales.js'
import {
  createContactBody,
  draftInvoiceBody,
  eventsQuery,
  issueInvoiceBody,
} from '../src/api/schemas.js'

/**
 * The event stream (spec 9.3, 10.2).
 *
 * Two claims worth holding on to. The stream is resumable from a cursor
 * without gaps or repeats, which is what makes polling a substitute for
 * webhooks. And an event cannot exist for a change that did not commit —
 * which is the only reason a transactional outbox is worth the trouble over
 * simply publishing after the fact.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database
let entityId: string
let token: string

const contextFor = async (idempotencyKey?: string) => {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey)
  return resolveRequestContext({
    database,
    request: new Request('https://klopt.test/api/v1/events', { headers }),
  })
}

const events = async (query: Record<string, string> = {}) =>
  handleListEvents(await contextFor(), eventsQuery.parse(query))

async function anIssuedInvoice(): Promise<string> {
  const number = `DEB-${randomUUID().slice(0, 8)}`
  await handleCreateContact(
    await contextFor(uuidv7()),
    createContactBody.parse({ number, name: 'Stroom BV', isCustomer: true, countryCode: 'NL' }),
  )

  const draft = await handleDraftInvoice(
    await contextFor(uuidv7()),
    draftInvoiceBody.parse({
      contactNumber: number,
      issueDate: '2026-03-15',
      buyerReference: 'KOSTENPLAATS-1',
      lines: [
        {
          description: 'Advies',
          quantity: '1',
          unitCode: 'HUR',
          unitPrice: '10000',
          revenueAccountNumber: '8000',
          taxCode: 'H21',
        },
      ],
    }),
  )

  const invoiceId = (draft.body as { id: string }).id
  await handleIssueInvoice(await contextFor(uuidv7()), invoiceId, issueInvoiceBody.parse({}))
  return invoiceId
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)

  entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)

  const issued = await issueToken(database, {
    entityId,
    name: 'events-test',
    permissions: ['*'],
    actorKind: 'script',
    actorId: 'test',
  })
  token = issued.token
}, 60_000)

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('the event stream', () => {
  it('publishes what happened and what it happened to, and nothing else', async () => {
    const invoiceId = await anIssuedInvoice()

    const page = await events()
    const issued = page.body.events.find(
      (event) => event.type === 'sales.invoice.issued' && event.resource.id === invoiceId,
    )

    expect(issued).toBeDefined()
    expect(issued?.version).toBe(EVENT_TYPES['sales.invoice.issued'].version)
    expect(issued?.resource.type).toBe('sales_invoice')

    // Thin, deliberately. A payload here would be a second definition of an
    // invoice, and it would put a customer's details in a webhook.
    expect(Object.keys(issued ?? {}).sort()).toEqual([
      'entityId',
      'id',
      'occurredAt',
      'resource',
      'type',
      'version',
    ])
  })

  it('posts the journal entry behind the invoice as its own event', async () => {
    await anIssuedInvoice()

    const page = await events({ type: 'ledger.entry.posted' })
    expect(page.body.events.length).toBeGreaterThan(0)
    expect(page.body.events.every((event) => event.type === 'ledger.entry.posted')).toBe(true)
    expect(page.body.events.every((event) => event.resource.type === 'journal_entry')).toBe(true)
  })

  it('resumes from a cursor without gaps or repeats', async () => {
    // The property that makes polling a substitute for webhooks: two pages
    // taken with the cursor equal one page taken whole.
    await anIssuedInvoice()
    const whole = await events({ limit: '1000' })
    const all = whole.body.events.map((event) => event.id)
    expect(all.length).toBeGreaterThan(2)

    const first = await events({ limit: '2' })
    expect(first.body.events).toHaveLength(2)
    expect(first.body.nextCursor).toBe(first.body.events[1]?.id)

    const rest = await events({ after: first.body.nextCursor!, limit: '1000' })
    const paged = [...first.body.events, ...rest.body.events].map((event) => event.id)

    expect(paged).toEqual(all)
    expect(new Set(paged).size).toBe(paged.length)
  })

  it('hands back a null cursor on an idle stream rather than resetting it', async () => {
    // A caller who treats "no events" as "start again" replays the whole
    // stream every poll. Null says "keep the cursor you have".
    const whole = await events({ limit: '1000' })
    const last = whole.body.nextCursor!

    const idle = await events({ after: last })
    expect(idle.body.events).toHaveLength(0)
    expect(idle.body.nextCursor).toBeNull()
  })

  it('cannot publish an event for a change that did not commit', async () => {
    // The whole reason for a transactional outbox rather than publishing after
    // the fact.
    //
    // Written against the transaction rather than a handler, on purpose. A
    // handler test would have the throw happen *before* the enqueue line is
    // reached, and would then pass just as happily if the event were published
    // in a transaction of its own — proving "no event when we never got there"
    // instead of "no event when the change rolled back".
    const before = await events({ limit: '1000' })
    const marker = uuidv7()

    await expect(
      withSales(database, async ({ ledger }) => {
        await ledger.enqueueEvent({
          entityId,
          type: 'sales.invoice.issued',
          version: 1,
          payload: { resourceType: 'sales_invoice', resourceId: marker },
        })

        // Everything up to here would commit on its own. It must not.
        throw new Error('the change failed after the event was enqueued')
      }),
    ).rejects.toThrow('the change failed')

    const after = await events({ limit: '1000' })
    expect(after.body.events.map((event) => event.id)).toEqual(
      before.body.events.map((event) => event.id),
    )
    expect(after.body.events.some((event) => event.resource.id === marker)).toBe(false)
  })
})

/**
 * A sealed snapshot publishes itself (ADR 0051).
 *
 * The cheapest of the five new events to drive end to end, and the one where
 * the timing argument is strongest: an archival system wants the hash the
 * moment it exists, and "whenever it next polls" is too late to prove anything
 * about when.
 */
describe('sealing a book year publishes it', () => {
  it('emits compliance.snapshot.sealed naming the snapshot', async () => {
    const { handleSealSnapshot } = await import('../src/api/handlers/snapshots.js')
    const { sealSnapshotBody } = await import('../src/api/schemas.js')

    const sealed = await handleSealSnapshot(
      await contextFor(),
      sealSnapshotBody.parse({ fiscalYear: '2026' }),
    )
    const snapshotId = (sealed.body as { id: string }).id

    const published = (await events()).body.events.find(
      (event) => event.type === 'compliance.snapshot.sealed',
    )

    expect(published).toBeDefined()
    expect(published?.resource.id).toBe(snapshotId)
    expect(published?.resource.type).toBe('snapshot')
    expect(published?.version).toBe(EVENT_TYPES['compliance.snapshot.sealed'].version)
  }, 60_000)
})

/**
 * Every type in the catalogue is emitted by something (ADR 0051).
 *
 * `packages/db/test/modules.test.ts` already refuses a type no module
 * *declares*, which catches a dead name. It does not catch the other half: a
 * type declared, documented and published, that no line of code ever writes.
 * A consumer subscribes to it and waits forever, and nothing fails.
 *
 * So this reads the source. Crude, and the right kind of crude — the question
 * is literally "does this string appear at an emit site", and any cleverer
 * mechanism would have to be kept in step with the emitting itself.
 */
describe('every published event type is actually emitted', () => {
  const ROOTS = [
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src'),
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'src'),
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'core', 'src'),
  ]

  function everySource(directory: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) out.push(...everySource(path))
      else if (entry.name.endsWith('.ts')) out.push(readFileSync(path, 'utf8'))
    }
    return out
  }

  it('has an emit site for each one', () => {
    const sources = ROOTS.flatMap((root) => everySource(root))
      // The catalogue itself names every type; it is the declaration, not an
      // emit, and counting it would make this test agree with itself.
      .filter((source) => !source.includes('export const EVENT_TYPES'))
      .join('\n')

    const unemitted = Object.keys(EVENT_TYPES).filter(
      (type) => !sources.includes(`type: '${type}'`),
    )

    expect(unemitted).toEqual([])
  })

  it('would notice a type nobody writes', () => {
    // The check is only worth having if an absent emit fails it.
    const sources = ROOTS.flatMap((root) => everySource(root)).join('\n')
    expect(sources.includes("type: 'ledger.entry.invented'")).toBe(false)
  })
})
