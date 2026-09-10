import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  closeDatabase,
  createDatabase,
  runExactDocumentBatch,
  runMigrations,
  withExactDocuments,
  type Database,
  type DocumentRunRow,
} from '@klopt/db'
import { seedEntity } from '@klopt/db/testing'
import type { DocumentStore, ExactClient, ExactPage } from '@klopt/core'

/**
 * The document archive, a batch at a time (spec 13).
 *
 * Everything worth testing here is about *stopping*: the batch has to be
 * bounded, resumable, and willing to give up its turn when Exact's daily budget
 * is running out. A job that only works when it runs to completion in one go is
 * a job that never finishes on a real archive.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database

/** A store that keeps bytes in memory and reports the hash, like the real one. */
function memoryStore(): DocumentStore & { readonly kept: Map<string, Uint8Array> } {
  const kept = new Map<string, Uint8Array>()
  return {
    kept,
    async put(bytes: Uint8Array) {
      const { createHash } = await import('node:crypto')
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      kept.set(sha256, bytes)
      return { sha256, sizeBytes: bytes.byteLength, contentType: 'application/pdf' }
    },
    get: () => Promise.reject(new Error('not used')),
    delete: () => Promise.resolve({ outcome: 'absent' as const }),
  } as unknown as DocumentStore & { readonly kept: Map<string, Uint8Array> }
}

const guid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

/**
 * A stand-in Exact holding `count` documents with one attachment each.
 *
 * `budget` is what its rate-limit header would say, so the pause can be
 * provoked without waiting for a real one.
 */
function fakeExact(options: {
  readonly count: number
  readonly budget?: number
  readonly downloads?: string[]
}): ExactClient {
  const documents = Array.from({ length: options.count }, (_, index) => ({
    ID: guid(1000 + index),
    Subject: `Bon ${String(index)}`,
    DocumentDate: '2026-03-31T00:00:00',
  }))
  const attachments = documents.map((document, index) => ({
    ID: guid(5000 + index),
    Document: document.ID,
    FileName: `bon-${String(index)}.pdf`,
    FileSize: 1024,
    Url: `https://exact.test/files/${String(index)}`,
  }))

  const page = <T>(rows: readonly T[]): ExactPage<Record<string, unknown>> => ({
    rows: rows as unknown as Record<string, unknown>[],
    next: null,
  })

  return {
    me: () => Promise.reject(new Error('not used')),
    divisions: () => Promise.reject(new Error('not used')),
    mayRead: () => Promise.resolve(true),
    log: [],
    page: (request: { path: string }) =>
      Promise.resolve(request.path.includes('Attachments') ? page(attachments) : page(documents)),
    nextPage: () => Promise.resolve(page([])),
    download: (url: string) => {
      options.downloads?.push(url)
      return Promise.resolve(new Uint8Array(randomBytes(64)))
    },
    rateLimit: () => ({
      dailyRemaining: options.budget ?? 5000,
      dailyResetAt: null,
      minutelyRemaining: 50,
      minutelyResetAt: null,
    }),
  } as unknown as ExactClient
}

async function newRun(): Promise<DocumentRunRow> {
  const entityId = await seedEntity(database)
  return withExactDocuments(database, (repository) =>
    repository.request({ entityId, divisionCode: 3242325, requestedBy: 'human-test' }),
  )
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
}, 120_000)

afterAll(async () => {
  await closeDatabase(database)
})

describe('one batch', () => {
  it('stores what it fetches and stops at the limit', async () => {
    const run = await newRun()
    const store = memoryStore()
    const downloads: string[] = []

    const result = await runExactDocumentBatch({
      database,
      store,
      client: fakeExact({ count: 10, downloads }),
      run,
      limit: 4,
    })

    // Bounded. The other six are the next tick's problem.
    expect(downloads).toHaveLength(4)
    expect(result.attachmentsStored).toBe(4)
    expect(store.kept.size).toBe(4)
    // Not finished, and the cursor did not move — the same page is revisited.
    expect(result.state).toBe('running')
    expect(result.cursor).toBeNull()
  })

  it('resumes without downloading what it already has', async () => {
    /**
     * The reason `exact_attachments` exists. Documents are content-addressed,
     * so re-storing one is cheap — but a resumed run without a skip list pulls
     * the whole archive over the wire again to discover, by hash, that it
     * already had it.
     */
    const run = await newRun()
    const store = memoryStore()
    const first: string[] = []
    const second: string[] = []

    const one = await runExactDocumentBatch({
      database,
      store,
      client: fakeExact({ count: 10, downloads: first }),
      run,
      limit: 4,
    })
    await withExactDocuments(database, (repository) =>
      repository.advance({ id: run.id, cursor: one.cursor, ...counts(one), state: 'pending' }),
    )

    // Re-read this entity's own run. `claim` takes the oldest pending across
    // the instance, which in a shared test database is somebody else's.
    const resumed = await withExactDocuments(database, (repository) =>
      repository.find(run.entityId),
    )
    const two = await runExactDocumentBatch({
      database,
      store,
      client: fakeExact({ count: 10, downloads: second }),
      run: resumed!,
      limit: 4,
    })

    // The skip list holds what the first batch stored.
    const known = await withExactDocuments(database, (repository) =>
      repository.known(run.entityId, [guid(5000), guid(5001), guid(5002), guid(5003)]),
    )
    expect(known.size).toBe(4)

    expect(two.attachmentsSkipped).toBe(4)
    expect(two.attachmentsStored).toBe(4)
    // Four skipped and four fetched: none of the first four came down twice.
    expect(second).toHaveLength(4)
    expect(new Set([...first, ...second]).size).toBe(8)
  })

  it('finishes when every attachment on the last page is here', async () => {
    const run = await newRun()

    const result = await runExactDocumentBatch({
      database,
      store: memoryStore(),
      client: fakeExact({ count: 3 }),
      run,
      limit: 50,
    })

    expect(result.state).toBe('done')
    expect(result.attachmentsStored).toBe(3)
  })

  it('pauses rather than spending Exact’s last requests', async () => {
    /**
     * Not an error, and not a failure: tomorrow's budget finishes it. Stopping
     * with room to spare is what keeps the rest of the product able to reach
     * Exact today — an import that spends the last request breaks the dry run
     * somebody is trying to read.
     */
    const run = await newRun()

    const result = await runExactDocumentBatch({
      database,
      store: memoryStore(),
      client: fakeExact({ count: 10, budget: 120 }),
      run,
      limit: 50,
      reserveRequests: 200,
    })

    expect(result.state).toBe('paused')
    expect(result.attachmentsStored).toBe(0)
    expect(result.failure).toContain('120 Exact requests left')
  })

  it('keeps what it managed when something throws halfway', async () => {
    // A run that fell over on attachment four hundred must not lose the first
    // three hundred and ninety-nine.
    const run = await newRun()
    const store = memoryStore()
    let served = 0

    const client = fakeExact({ count: 10 })
    const failing = {
      ...client,
      download: (url: string) => {
        served += 1
        if (served > 2) return Promise.reject(new Error('the socket went away'))
        return client.download(url)
      },
    }

    const result = await runExactDocumentBatch({ database, store, client: failing, run, limit: 50 })

    expect(result.state).toBe('failed')
    expect(result.failure).toContain('socket')
    expect(result.attachmentsStored).toBe(2)
    expect(store.kept.size).toBe(2)
  })
})

describe('asking for a run', () => {
  it('joins the one already going rather than starting a second', async () => {
    // One walk over one archive. Two would double the rate-limit spend and race
    // each other for the same attachments.
    const entityId = await seedEntity(database)

    const first = await withExactDocuments(database, (repository) =>
      repository.request({ entityId, divisionCode: 1000, requestedBy: 'a' }),
    )

    // Put it in flight directly rather than through `claim`, which takes the
    // oldest pending run across the whole instance and would just as happily
    // pick up another test's.
    await withExactDocuments(database, (repository) =>
      repository.advance({
        id: first.id,
        cursor: 'halfway',
        documentsSeen: 0,
        attachmentsStored: 0,
        attachmentsSkipped: 0,
        bytesStored: 0n,
        state: 'running',
      }),
    )

    const second = await withExactDocuments(database, (repository) =>
      repository.request({ entityId, divisionCode: 1000, requestedBy: 'b' }),
    )

    expect(second.id).toBe(first.id)
    expect(second.state).toBe('running')
    // And it was not rewound: the walk keeps its place.
    expect(second.cursor).toBe('halfway')
  })

  it('restarts one that has finished', async () => {
    const entityId = await seedEntity(database)
    const first = await withExactDocuments(database, (repository) =>
      repository.request({ entityId, divisionCode: 1000, requestedBy: 'a' }),
    )
    await withExactDocuments(database, (repository) =>
      repository.advance({
        id: first.id,
        cursor: 'somewhere',
        documentsSeen: 0,
        attachmentsStored: 0,
        attachmentsSkipped: 0,
        bytesStored: 0n,
        state: 'done',
      }),
    )

    const again = await withExactDocuments(database, (repository) =>
      repository.request({ entityId, divisionCode: 1000, requestedBy: 'b' }),
    )

    // Asking again after it finished means "pick up anything new", so the
    // cursor goes back to the start rather than resuming from a stale one.
    expect(again.state).toBe('pending')
    expect(again.cursor).toBeNull()
  })
})

function counts(result: {
  documentsSeen: number
  attachmentsStored: number
  attachmentsSkipped: number
  bytesStored: bigint
}) {
  return {
    documentsSeen: result.documentsSeen,
    attachmentsStored: result.attachmentsStored,
    attachmentsSkipped: result.attachmentsSkipped,
    bytesStored: result.bytesStored,
  }
}
