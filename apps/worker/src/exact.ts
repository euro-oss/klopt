import { createExactClient, resolveDocumentStore } from '@klopt/adapters'
import {
  closeDatabase,
  createDatabase,
  decryptSecret,
  runExactDocumentBatch,
  withExactConnection,
  withExactDocuments,
  type Database,
} from '@klopt/db'
import type { DocumentStore } from '@klopt/core'

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

export async function importExactDocuments(
  database: Database,
  store: DocumentStore = storeFor(),
): Promise<DocumentImportSummary | null> {
  const run = await withExactDocuments(database, (repository) => repository.claim(new Date()))
  if (run === null) return null

  const connection = await withExactConnection(database, (repository) =>
    repository.withCredentials(run.entityId),
  )

  if (connection === null || connection.refreshToken === null) {
    await withExactDocuments(database, (repository) =>
      repository.advance({
        id: run.id,
        cursor: run.cursor,
        documentsSeen: 0,
        attachmentsStored: 0,
        attachmentsSkipped: 0,
        bytesStored: 0n,
        state: 'failed',
        lastError: 'The Exact connection is gone or has not been authorised.',
      }),
    )
    return {
      entityId: run.entityId,
      state: 'failed',
      stored: 0,
      skipped: 0,
      failure: 'no connection',
    }
  }

  const client = createExactClient({
    app: {
      clientId: connection.clientId,
      clientSecret: decryptSecret(connection.clientSecret) ?? '',
    },
    tokens: {
      accessToken: connection.accessToken ?? '',
      refreshToken: decryptSecret(connection.refreshToken) ?? '',
      expiresAt: connection.accessTokenExpiresAt ?? '1970-01-01T00:00:00.000Z',
    },
    base: connection.baseUrl,
    // Exact rotates the refresh token on every refresh and kills the old one,
    // so a pair that is not written down before the next call is a connection
    // this job silently breaks.
    onTokens: async (next) => {
      await withExactConnection(database, (repository) =>
        repository.storeTokens({
          entityId: run.entityId,
          accessToken: next.accessToken,
          refreshToken: next.refreshToken,
          expiresAt: next.expiresAt,
        }),
      )
    },
  })

  const result = await runExactDocumentBatch({ database, store, client, run })

  await withExactDocuments(database, (repository) =>
    repository.advance({
      id: run.id,
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
    entityId: run.entityId,
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
