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
import { issueToken } from '@klopt/db'
import { seedEntity } from '@klopt/db/testing'
import { resolveRequestContext } from '../src/api/auth.js'
import { setDatabaseForTest } from '../src/api/database.js'
import { handleExactDocumentStatus } from '../src/api/handlers/exact.js'
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

/**
 * Entities this file made, so it can take its litter away.
 *
 * Not "delete everything called Test Beheer B.V.": that is every fixture in
 * the repository, and one day somebody's real administration.
 */
const created: string[] = []

async function seedRunEntity(): Promise<string> {
  const entityId = await seedEntity(database)
  created.push(entityId)
  return entityId
}

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
  const entityId = await seedRunEntity()
  return withExactDocuments(database, (repository) =>
    repository.request({ entityId, divisionCode: 3242325, requestedBy: 'human-test' }),
  )
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
  setDatabaseForTest(database)
}, 120_000)

afterAll(async () => {
  /**
   * Clear up after ourselves.
   *
   * These tests create a run per case, for entities with no Exact connection.
   * Left behind in a shared development database they are claimed ahead of
   * real work — `claim` takes the oldest pending anywhere — so thirty of them
   * held up a genuine import for an hour while the worker logged an error
   * about each one in turn. The worker copes with that now; leaving the litter
   * anyway would just be rude to whoever is using the same Postgres.
   */
  if (created.length > 0) {
    const ids = created.map((id) => `'${id}'`).join(', ')
    await database.execute(`delete from klopt.exact_document_runs where entity_id in (${ids})`)
  }

  setDatabaseForTest(null)
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
    const entityId = await seedRunEntity()

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
    const entityId = await seedRunEntity()
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

describe('a run nobody picks up', () => {
  /**
   * The symptom that started this: the screen said "waiting for the worker"
   * and kept saying it, because `pnpm dev` started only the web app. A pending
   * run looks the same whether the worker is about to claim it or is not
   * running at all, so the status has to distinguish them.
   */
  it('says nothing is wrong while the run is fresh', async () => {
    const entityId = await seedRunEntity()
    await withExactDocuments(database, (repository) =>
      repository.request({ entityId, divisionCode: 1000, requestedBy: 'a' }),
    )

    const status = await handleExactDocumentStatus(await contextFor(entityId))

    expect(status.body.requested).toBe(true)
    if (!status.body.requested) throw new Error('unreachable')
    expect(status.body.state).toBe('pending')
    expect(status.body.workerSilent).toBe(false)
  })

  it('flags a run that has sat unclaimed', async () => {
    const entityId = await seedRunEntity()
    const run = await withExactDocuments(database, (repository) =>
      repository.request({ entityId, divisionCode: 1000, requestedBy: 'a' }),
    )

    // Ten minutes ago, and never started.
    await database.execute(
      `update klopt.exact_document_runs set requested_at = now() - interval '10 minutes' where id = '${run.id}'`,
    )

    const status = await handleExactDocumentStatus(await contextFor(entityId))

    if (!status.body.requested) throw new Error('unreachable')
    expect(status.body.workerSilent).toBe(true)
  })

  it('says nothing once the worker has it, however long it takes', async () => {
    // A long-running import is not a missing worker. Only "never claimed" is.
    const entityId = await seedRunEntity()
    const run = await withExactDocuments(database, (repository) =>
      repository.request({ entityId, divisionCode: 1000, requestedBy: 'a' }),
    )
    await withExactDocuments(database, (repository) =>
      repository.advance({
        id: run.id,
        cursor: 'halfway',
        documentsSeen: 0,
        attachmentsStored: 0,
        attachmentsSkipped: 0,
        bytesStored: 0n,
        state: 'pending',
      }),
    )
    await database.execute(
      `update klopt.exact_document_runs
         set requested_at = now() - interval '2 hours', started_at = now() - interval '2 hours'
       where id = '${run.id}'`,
    )

    const status = await handleExactDocumentStatus(await contextFor(entityId))

    if (!status.body.requested) throw new Error('unreachable')
    expect(status.body.workerSilent).toBe(false)
  })
})

async function contextFor(entityId: string) {
  const { token } = await issueToken(database, {
    entityId,
    name: 'status-test',
    permissions: ['*'],
    actorKind: 'human',
    actorId: `human-${entityId.slice(0, 8)}`,
  })
  return resolveRequestContext({
    database,
    request: new Request('https://klopt.test/x', {
      headers: { authorization: `Bearer ${token}` },
    }),
  })
}

describe('a queue full of runs that can never go anywhere', () => {
  /**
   * What went wrong in practice. `claim` takes the oldest pending run
   * anywhere, so thirty abandoned runs — administrations that had since
   * disconnected — sat ahead of a real one. The worker retired exactly one per
   * tick and logged an error about it, so a genuine import waited an hour
   * behind junk while the console filled with a message about somebody else's
   * administration.
   *
   * One tick should clear them and get to the work.
   */
  it('retires them all in one pass instead of one per tick', async () => {
    const { importExactDocuments } = await import('../../worker/src/exact.js')

    // Five runs with no Exact connection behind them, tracked by id — the
    // assertion has to be about these five and not about whatever else is in a
    // shared development database.
    const mine: string[] = []
    for (let index = 0; index < 5; index += 1) {
      const entityId = await seedRunEntity()
      mine.push(entityId)
      const run = await withExactDocuments(database, (repository) =>
        repository.request({ entityId, divisionCode: 1000, requestedBy: 'test' }),
      )
      // Oldest first, so `claim` reaches these before anything else that
      // happens to be queued in a shared database.
      await database.execute(
        `update klopt.exact_document_runs set requested_at = '1990-01-01' where id = '${run.id}'`,
      )
    }

    /**
     * Scoped to this file's own entities, and that matters.
     *
     * The first version of this counted *every* pending run in the database
     * and asserted it reached zero. On a shared development Postgres that
     * swept up a real administration's run and fired a batch at somebody's
     * production Exact — the exact class of accident the cleanup above exists
     * to prevent, committed by the test asserting it.
     */
    const list = mine.map((id) => `'${id}'`).join(', ')

    const before = await database.execute(
      `select count(*)::int as pending from klopt.exact_document_runs
        where state = 'pending' and entity_id in (${list})`,
    )
    expect((before[0] as { pending: number }).pending).toBe(5)

    // One tick clears all five rather than stopping at the first. The fetch
    // refuses outright: if this ever reached a real connection, the test would
    // fail rather than quietly talk to somebody's Exact.
    const noNetwork = (() => {
      throw new Error('a unit test must not reach the network')
    }) as unknown as typeof globalThis.fetch
    await importExactDocuments(database, memoryStore(), noNetwork)

    const after = await database.execute(
      `select count(*)::int as pending from klopt.exact_document_runs
        where state = 'pending' and entity_id in (${list})`,
    )
    expect((after[0] as { pending: number }).pending).toBe(0)
  })
})

describe('a worker that died mid-batch', () => {
  /**
   * A claim is a lease, not a flag. `running` means "somebody has this", and
   * if that somebody dies — a deploy, a crash, a closed laptop — the row used
   * to stay `running` and nothing ever picked it up again. Three were sitting
   * permanently stuck in a development database before this existed.
   */
  it('leaves a fresh claim alone', async () => {
    const entityId = await seedRunEntity()
    const run = await withExactDocuments(database, (repository) =>
      repository.request({ entityId, divisionCode: 1000, requestedBy: 'a' }),
    )
    await withExactDocuments(database, (repository) => repository.claim(new Date()))

    // Somebody is working on it right now.
    const again = await withExactDocuments(database, (repository) => repository.claim(new Date()))
    expect(again?.id).not.toBe(run.id)
  })

  it('takes back a claim nobody has touched for the lease', async () => {
    const entityId = await seedRunEntity()
    const run = await withExactDocuments(database, (repository) =>
      repository.request({ entityId, divisionCode: 1000, requestedBy: 'a' }),
    )
    await database.execute(
      `update klopt.exact_document_runs set requested_at = '1990-01-01' where id = '${run.id}'`,
    )
    await withExactDocuments(database, (repository) => repository.claim(new Date()))

    // The worker that had it went away twenty minutes ago.
    await database.execute(
      `update klopt.exact_document_runs
          set updated_at = now() - interval '20 minutes'
        where id = '${run.id}'`,
    )

    const reclaimed = await withExactDocuments(database, (repository) =>
      repository.claim(new Date()),
    )
    expect(reclaimed?.id).toBe(run.id)
  })
})

describe('a worker that cannot decrypt what it stored', () => {
  /**
   * `decryptSecret` returns null both for "no KLOPT_ENCRYPTION_KEY" and for
   * "this does not decrypt", and the first version fed that into `?? ''`. An
   * empty client secret reaches Exact and comes back `invalid_request` — so a
   * worker with no key configured reported a perfectly good OAuth connection
   * as broken, and that is what it looked like for a while.
   *
   * A deployment problem should say it is one.
   */
  it('says the key is missing rather than blaming the connection', async () => {
    const { importExactDocuments } = await import('../../worker/src/exact.js')

    const entityId = await seedRunEntity()
    await withExactDocuments(database, (repository) =>
      repository.request({ entityId, divisionCode: 1000, requestedBy: 'test' }),
    )
    // A connection that exists and is authorised, so the only thing wrong is
    // that its secrets cannot be read back.
    await database.execute(
      `insert into klopt.exact_connections
         (id, entity_id, base_url, client_id, client_secret, redirect_uri, refresh_token, division_code)
       values (gen_random_uuid(), '${entityId}', 'https://start.exactonline.nl', 'c',
               'v1.not.a.valid.envelope', 'https://x.test/cb', 'v1.not.a.valid.envelope', 1000)`,
    )

    await database.execute(
      `update klopt.exact_document_runs set requested_at = '1990-01-01' where entity_id = '${entityId}'`,
    )
    const noNetwork = (() => {
      throw new Error('a unit test must not reach the network')
    }) as unknown as typeof globalThis.fetch
    await importExactDocuments(database, memoryStore(), noNetwork)

    const [row] = await database.execute(
      `select last_error from klopt.exact_document_runs where entity_id = '${entityId}'`,
    )
    const error = (row as { last_error: string }).last_error

    expect(error).toMatch(/KLOPT_ENCRYPTION_KEY|different KLOPT_ENCRYPTION_KEY/)
    // And specifically not the message that sends somebody to re-authorise a
    // connection that was never the problem.
    expect(error).not.toContain('invalid_request')
  })
})
