import { createExactClient, resolveDocumentStore } from '@klopt/adapters'
import {
  closeDatabase,
  createDatabase,
  runExactDocumentBatch,
  secretsAvailable,
  withExactConnection,
  withExactDocuments,
  type Database,
} from '@klopt/db'
import type { DocumentStore } from '@klopt/core'
import type { ExactConnectionCredentials } from '@klopt/db'

/**
 * Bringing Exact's document archive across, a batch at a time (spec 13).
 *
 * The rest of the Exact import runs inside a request. This cannot: an
 * administration with ten years of scanned invoices has tens of thousands of
 * files behind a daily rate limit, which is hours of work that has to survive a
 * deploy.
 *
 * So the worker claims one run, does a bounded batch, writes down where it got
 * to and returns. Every few minutes, until Exact has no more pages.
 *
 * ## One run at a time, across the whole instance
 *
 * Not one per administration in parallel. The limit that matters is Exact's,
 * and it is per app rather than per administration — three administrations
 * importing at once would spend the budget three times as fast and all three
 * would stall. Sequential is also kinder to the document store, which is
 * receiving several gigabytes.
 */

function storeFor(): DocumentStore {
  return resolveDocumentStore(process.env)
}

export interface DocumentImportSummary {
  readonly entityId: string | null
  readonly state: string
  readonly stored: number
  readonly skipped: number
  readonly failure: string | null
}

/**
 * How many unusable runs to clear before giving up on this tick.
 *
 * A run whose administration has since disconnected can never make progress.
 * Retiring one per tick lets a handful of them hold up real work for twenty
 * minutes — which is exactly what happened: thirty abandoned runs sat ahead of
 * a real one, and every two minutes the worker retired one and logged an error
 * about it.
 *
 * Bounded rather than an unbounded loop, so a pathological queue cannot turn
 * one tick into an unbounded amount of work.
 */
const MAX_RETIRED_PER_TICK = 50

/**
 * The credentials for one administration, or why it cannot be used.
 *
 * `withCredentials` **already decrypts**. The first version of this called
 * `decryptSecret` on the results anyway, which is a second decryption of
 * plaintext: it returns null, `?? ''` turned that into an empty client secret,
 * Exact answered `invalid_request`, and a perfectly good OAuth connection was
 * reported as broken. It cost an hour of looking at the wrong thing.
 *
 * The repository maps a failed decryption of the client secret to `''`, which
 * is the one case worth separating out here — an empty secret means the key is
 * missing or wrong, not that anybody needs to re-authorise.
 */
async function credentialsFor(
  database: Database,
  entityId: string,
): Promise<
  | { readonly ok: true; readonly connection: ExactConnectionCredentials }
  | { readonly ok: false; readonly reason: string }
> {
  const connection = await withExactConnection(database, (repository) =>
    repository.withCredentials(entityId),
  )

  if (connection === null) {
    return { ok: false, reason: 'There is no Exact connection for this administration.' }
  }
  if (connection.refreshToken === null || connection.clientSecret === '') {
    return {
      ok: false,
      reason: secretsAvailable()
        ? 'The Exact connection has not been authorised, or its stored credentials were encrypted with a different KLOPT_ENCRYPTION_KEY. Authorise it again.'
        : 'KLOPT_ENCRYPTION_KEY is not set on the worker, so the stored Exact credentials cannot be read. This is configuration, not a broken connection.',
    }
  }

  return { ok: true, connection }
}

export async function importExactDocuments(
  database: Database,
  store: DocumentStore = storeFor(),
  /**
   * The HTTP the Exact client uses. Injected only so a test can be certain it
   * reaches no real administration — `claim` takes the oldest run anywhere,
   * which in a shared development database can be somebody's live connection.
   */
  fetchImpl?: typeof globalThis.fetch,
): Promise<DocumentImportSummary | null> {
  let run = await withExactDocuments(database, (repository) => repository.claim(new Date()))
  let credentials = run === null ? null : await credentialsFor(database, run.entityId)

  // Retire the runs that cannot go anywhere, and keep looking. Quietly: an
  // administration that disconnected is not news every two minutes.
  for (let retired = 0; run !== null && credentials?.ok === false; retired += 1) {
    const unusable = run
    const why = credentials.reason
    await withExactDocuments(database, (repository) =>
      repository.advance({
        id: unusable.id,
        cursor: unusable.cursor,
        documentsSeen: 0,
        attachmentsStored: 0,
        attachmentsSkipped: 0,
        bytesStored: 0n,
        state: 'failed',
        lastError: why,
      }),
    )

    if (retired >= MAX_RETIRED_PER_TICK) return null

    run = await withExactDocuments(database, (repository) => repository.claim(new Date()))
    credentials = run === null ? null : await credentialsFor(database, run.entityId)
  }

  if (run === null || credentials === null || !credentials.ok) return null

  const { connection } = credentials

  // Narrowed once, so the closures below do not each have to re-prove it.
  const claimed = run

  const client = createExactClient({
    app: {
      clientId: connection.clientId,
      clientSecret: connection.clientSecret,
    },
    tokens: {
      accessToken: connection.accessToken ?? '',
      // Non-null by the guard in `credentialsFor`.
      refreshToken: connection.refreshToken ?? '',
      expiresAt: connection.accessTokenExpiresAt ?? '1970-01-01T00:00:00.000Z',
    },
    base: connection.baseUrl,
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
    // Exact rotates the refresh token on every refresh and kills the old one,
    // so a pair that is not written down before the next call is a connection
    // this job silently breaks.
    onTokens: async (next) => {
      await withExactConnection(database, (repository) =>
        repository.storeTokens({
          entityId: claimed.entityId,
          accessToken: next.accessToken,
          refreshToken: next.refreshToken,
          expiresAt: next.expiresAt,
        }),
      )
    },
  })

  const result = await runExactDocumentBatch({ database, store, client, run: claimed })

  await withExactDocuments(database, (repository) =>
    repository.advance({
      id: claimed.id,
      cursor: result.cursor,
      documentsSeen: result.documentsSeen,
      attachmentsStored: result.attachmentsStored,
      attachmentsSkipped: result.attachmentsSkipped,
      bytesStored: result.bytesStored,
      // `running` goes back to `pending` so the next tick can claim it. The
      // claim is what stops two workers on the same run, and a row left
      // `running` after this returns would never be picked up again.
      state: result.state === 'running' ? 'pending' : result.state,
      lastError: result.failure,
    }),
  )

  return {
    entityId: claimed.entityId,
    state: result.state,
    stored: result.attachmentsStored,
    skipped: result.attachmentsSkipped,
    failure: result.failure,
  }
}

/** The job body, which owns its own connection because it runs on a schedule. */
export async function importExactDocumentsJob(databaseUrl: string): Promise<void> {
  const database = createDatabase({ url: databaseUrl, maxConnections: 2 })
  try {
    const summary = await importExactDocuments(database)
    if (summary === null) return

    console.info(
      `[worker] exact-documenten: ${summary.state}, ${String(summary.stored)} opgeslagen, ${String(summary.skipped)} overgeslagen`,
    )
    if (summary.failure !== null) {
      console.warn(`[worker] exact-documenten: ${summary.failure}`)
    }
  } finally {
    await closeDatabase(database)
  }
}
