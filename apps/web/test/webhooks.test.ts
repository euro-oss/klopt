import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7, verifyWebhook } from '@klopt/core'
import {
  closeDatabase,
  createDatabase,
  deliverWebhooks,
  issueToken,
  runMigrations,
  withSales,
  type Database,
} from '@klopt/db'
import { cleanupSeededBackgroundWork, seedEntity, seedSalesConfiguration } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import {
  handleCreateWebhook,
  handleDeleteWebhook,
  handleListWebhooks,
  handleReplayWebhook,
} from '../src/api/handlers/webhooks.js'
import { createWebhookBody, replayWebhookBody } from '../src/api/schemas.js'

/**
 * Webhook delivery (spec 10.2).
 *
 * Every request goes through an injected `fetch`, so this suite cannot reach
 * the network however wrong it gets. That seam exists because a previous test
 * in this repository reached somebody's live Exact account.
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
    request: new Request('https://klopt.test/api/v1/webhooks', { headers }),
  })
}

interface Attempt {
  readonly url: string
  readonly body: string
  readonly signature: string
  readonly eventId: string
}

/** A subscriber that answers however the test tells it to, and remembers. */
function subscriber(reply: (attempt: Attempt) => { status: number } | { throws: string }) {
  const seen: Attempt[] = []

  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    const headers = new Headers(init.headers)
    const attempt: Attempt = {
      url,
      // The deliverer always sends a JSON string. Narrowed rather than cast so
      // that a change to a stream or a Blob fails here instead of recording
      // "[object Object]" and quietly passing every assertion below.
      body: typeof init.body === 'string' ? init.body : '',
      signature: headers.get('klopt-signature') ?? '',
      eventId: headers.get('klopt-event-id') ?? '',
    }
    seen.push(attempt)

    const answer = reply(attempt)
    if ('throws' in answer) return Promise.reject(new Error(answer.throws))
    return Promise.resolve(new Response(null, { status: answer.status }))
  }

  return { seen, fetch }
}

/** An event to deliver, without going through a whole invoice. */
async function anEvent(): Promise<string> {
  const id = uuidv7()
  await withSales(database, ({ ledger }) =>
    ledger.enqueueEvent({
      entityId,
      type: 'sales.invoice.issued',
      version: 1,
      payload: { resourceType: 'sales_invoice', resourceId: id },
    }),
  )
  return id
}

/**
 * A subscriber of our own.
 *
 * The URL comes back because endpoints created by earlier tests in this file
 * are still subscribed and still receive everything. An assertion that says
 * "the subscriber got this" has to mean *this* subscriber, or it is reading
 * somebody else's post.
 */
async function anEndpoint(
  eventTypes: string[] = [],
): Promise<{ id: string; secret: string; url: string }> {
  const url = `https://example.com/hook/${randomUUID()}`
  const created = await handleCreateWebhook(
    await contextFor(uuidv7()),
    createWebhookBody.parse({ url, eventTypes }),
  )
  return { id: created.body.id, secret: created.body.secret, url }
}

beforeAll(async () => {
  // Delivery and registration tests use synthetic hosts; the real check is
  // covered by the private-URL case below and by packages/core outbound tests.
  process.env['KLOPT_ALLOW_PRIVATE_OUTBOUND'] = '1'
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)

  entityId = await seedEntity(database)
  await seedSalesConfiguration(database, entityId)

  const issued = await issueToken(database, {
    entityId,
    name: 'webhooks-test',
    permissions: ['*'],
    actorKind: 'script',
    actorId: 'test',
  })
  token = issued.token
}, 60_000)

/**
 * Every test takes its endpoints away again.
 *
 * Without this each one leaves a live subscriber behind, so a later
 * `deliverWebhooks` does the work of every test that ran before it — the file
 * got slower until it timed out. It also removes the coupling that made two
 * assertions here read somebody else's post before they were scoped by URL.
 */
afterEach(async () => {
  const listed = await handleListWebhooks(await contextFor())
  for (const endpoint of listed.body.endpoints) {
    await handleDeleteWebhook(await contextFor(uuidv7()), endpoint.id)
  }
})

afterAll(async () => {
  await cleanupSeededBackgroundWork(database)
  setDatabaseForTest(null)
  await closeDatabase(database)
})

describe('subscribing', () => {
  it('shows the signing secret once and never again', async () => {
    const endpoint = await anEndpoint()
    expect(endpoint.secret).toMatch(/^whsec_/)

    const listed = await handleListWebhooks(await contextFor())
    const row = listed.body.endpoints.find((entry) => entry.id === endpoint.id)

    expect(row).toBeDefined()
    expect(JSON.stringify(row)).not.toContain(endpoint.secret)
  })

  it('refuses a URL that is not https', () => {
    // The signature proves who sent it, not who read it on the way. Over plain
    // http the resource ids travel in the clear.
    expect(() => createWebhookBody.parse({ url: 'http://example.com/hook' })).toThrow()
  })

  it('refuses a private https URL at registration', async () => {
    const previous = process.env['KLOPT_ALLOW_PRIVATE_OUTBOUND']
    delete process.env['KLOPT_ALLOW_PRIVATE_OUTBOUND']
    try {
      await expect(
        handleCreateWebhook(
          await contextFor(uuidv7()),
          createWebhookBody.parse({ url: 'https://127.0.0.1/hook' }),
        ),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    } finally {
      if (previous === undefined) delete process.env['KLOPT_ALLOW_PRIVATE_OUTBOUND']
      else process.env['KLOPT_ALLOW_PRIVATE_OUTBOUND'] = previous
    }
  })

  it('refuses an event type that is not in the catalogue', async () => {
    await expect(
      handleCreateWebhook(
        await contextFor(uuidv7()),
        createWebhookBody.parse({
          url: 'https://example.com/hook',
          eventTypes: ['sales.invoice.exploded'],
        }),
      ),
    ).rejects.toThrow(/not in the catalogue|No such event type/)
  })
})

describe('delivering', () => {
  it('does not follow redirects and records the check failure without dialling', async () => {
    const endpoint = await anEndpoint()
    await anEvent()
    const target = subscriber(() => ({ status: 200 }))

    await deliverWebhooks(database, {
      fetch: (url, init) => {
        expect(init.redirect).toBe('manual')
        return target.fetch(url, init)
      },
      assertUrl: () => Promise.reject(new Error('Refusing to reach https://127.0.0.1/: private')),
    })

    expect(target.seen.filter((attempt) => attempt.url === endpoint.url)).toHaveLength(0)

    const listed = await handleListWebhooks(await contextFor())
    const row = listed.body.endpoints.find((entry) => entry.id === endpoint.id)
    expect(row?.attempts[0]?.error).toMatch(/private/i)
  })

  it('signs what it sends, verifiably, with the secret the subscriber was given', async () => {
    const endpoint = await anEndpoint()
    const resourceId = await anEvent()
    const target = subscriber(() => ({ status: 200 }))

    await deliverWebhooks(database, { fetch: target.fetch })

    const delivery = target.seen.find(
      (attempt) => attempt.url === endpoint.url && attempt.body.includes(resourceId),
    )
    expect(delivery).toBeDefined()

    // The receiver's side of the contract, run for real.
    const verdict = verifyWebhook(
      endpoint.secret,
      delivery!.body,
      delivery!.signature,
      Math.floor(Date.now() / 1000),
    )
    expect(verdict).toEqual({ ok: true })
  })

  it('sends a reference, not the invoice', async () => {
    const endpoint = await anEndpoint()
    const resourceId = await anEvent()
    const target = subscriber(() => ({ status: 200 }))

    await deliverWebhooks(database, { fetch: target.fetch })

    const delivery = target.seen.find(
      (attempt) => attempt.url === endpoint.url && attempt.body.includes(resourceId),
    )
    const payload = JSON.parse(delivery!.body) as Record<string, unknown>

    expect(Object.keys(payload).sort()).toEqual([
      'entityId',
      'id',
      'occurredAt',
      'resource',
      'type',
      'version',
    ])
    expect(payload['resource']).toEqual({ type: 'sales_invoice', id: resourceId })
  })

  it('only sends the types the endpoint asked for', async () => {
    const endpoint = await anEndpoint(['ledger.entry.posted'])
    await anEvent()
    const target = subscriber(() => ({ status: 200 }))

    await deliverWebhooks(database, { fetch: target.fetch })

    // The event above is a sales one, so this endpoint gets nothing — while
    // the ones from earlier tests, which asked for everything, do.
    const mine = target.seen.filter((attempt) => attempt.url === endpoint.url)
    expect(mine).toHaveLength(0)
  })

  it('does not move past an event the subscriber refused', async () => {
    // Ordered delivery is the whole reason for a cursor. An integration that
    // hears "sent" before "issued" has to model effects preceding causes.
    const endpoint = await anEndpoint()
    const first = await anEvent()
    const second = await anEvent()

    const target = subscriber((attempt) =>
      attempt.url === endpoint.url && attempt.body.includes(first)
        ? { status: 500 }
        : { status: 200 },
    )

    await deliverWebhooks(database, { fetch: target.fetch })

    const mine = target.seen.filter((attempt) => attempt.url === endpoint.url)
    expect(mine.some((attempt) => attempt.body.includes(first))).toBe(true)
    expect(mine.some((attempt) => attempt.body.includes(second))).toBe(false)
  })

  it('switches an endpoint off when the subscriber says stop, and says why', async () => {
    const endpoint = await anEndpoint()
    await anEvent()
    const target = subscriber(() => ({ status: 410 }))

    await deliverWebhooks(database, { fetch: target.fetch })

    const listed = await handleListWebhooks(await contextFor())
    const row = listed.body.endpoints.find((entry) => entry.id === endpoint.id)

    expect(row?.enabled).toBe(false)
    expect(row?.disabledReason).toContain('410')
  })

  it('records the attempt whichever way it went', async () => {
    const endpoint = await anEndpoint()
    await anEvent()
    const target = subscriber(() => ({ throws: 'ECONNREFUSED' }))

    await deliverWebhooks(database, { fetch: target.fetch })

    const listed = await handleListWebhooks(await contextFor())
    const row = listed.body.endpoints.find((entry) => entry.id === endpoint.id)

    expect(row?.attempts.length).toBeGreaterThan(0)
    expect(row?.attempts[0]?.error).toContain('ECONNREFUSED')
    expect(row?.attempts[0]?.responseStatus).toBeNull()
  })

  it('reports how far behind an endpoint is', async () => {
    const endpoint = await anEndpoint()
    await anEvent()
    await anEvent()

    const listed = await handleListWebhooks(await contextFor())
    const row = listed.body.endpoints.find((entry) => entry.id === endpoint.id)

    expect(row?.backlog).toBeGreaterThanOrEqual(2)
  })
})

describe('replaying', () => {
  /**
   * Slow on purpose, and allowed to be.
   *
   * A new endpoint starts with no cursor, which means the whole history — that
   * is the product decision, so that connecting an integration gives it what
   * happened rather than only what happens next. This test then does it three
   * times over, and each event is its own HTTP call and its own transaction so
   * that a crash mid-batch cannot lose the cursor.
   *
   * The default five seconds is a budget for a unit test, and this is not one.
   */
  it(
    'sends everything again from the beginning, and switches the endpoint back on',
    { timeout: 30_000 },
    async () => {
      const endpoint = await anEndpoint()
      const resourceId = await anEvent()

      // Deliver once, successfully.
      const mineIn = (seen: { url: string; body: string }[]) =>
        seen.filter((attempt) => attempt.url === endpoint.url)

      const first = subscriber(() => ({ status: 200 }))
      await deliverWebhooks(database, { fetch: first.fetch })
      expect(mineIn(first.seen).some((attempt) => attempt.body.includes(resourceId))).toBe(true)

      // Nothing to do the second time.
      const idle = subscriber(() => ({ status: 200 }))
      await deliverWebhooks(database, { fetch: idle.fetch })
      expect(mineIn(idle.seen).some((attempt) => attempt.body.includes(resourceId))).toBe(false)

      await handleReplayWebhook(
        await contextFor(uuidv7()),
        endpoint.id,
        replayWebhookBody.parse({ after: null }),
      )

      const again = subscriber(() => ({ status: 200 }))
      await deliverWebhooks(database, { fetch: again.fetch })
      expect(mineIn(again.seen).some((attempt) => attempt.body.includes(resourceId))).toBe(true)
    },
  )

  it('re-enables an endpoint that had been switched off', async () => {
    const endpoint = await anEndpoint()
    await anEvent()

    const refusing = subscriber((attempt) =>
      attempt.url === endpoint.url ? { status: 404 } : { status: 200 },
    )
    await deliverWebhooks(database, { fetch: refusing.fetch })

    const before = await handleListWebhooks(await contextFor())
    expect(before.body.endpoints.find((row) => row.id === endpoint.id)?.enabled).toBe(false)

    await handleReplayWebhook(await contextFor(uuidv7()), endpoint.id, replayWebhookBody.parse({}))

    const after = await handleListWebhooks(await contextFor())
    const row = after.body.endpoints.find((entry) => entry.id === endpoint.id)
    expect(row?.enabled).toBe(true)
    expect(row?.disabledReason).toBeNull()
  })
})
