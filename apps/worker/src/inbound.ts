import { createInboundSource, resolveDocumentStore } from '@klopt/adapters'
import {
  closeDatabase,
  createDatabase,
  decryptSecret,
  runInboundPoll,
  withInboundSources,
  type Database,
  type InboundSourceRow,
} from '@klopt/db'
import type { DocumentStore } from '@klopt/core'

/**
 * Emptying every configured mailbox into the purchase inbox (spec 6).
 *
 * The worker exists for exactly this kind of thing: work that has to happen
 * whether or not anybody has a browser open. It reaches for `@klopt/db` and
 * `@klopt/adapters` directly and never for a server function, so the queue does
 * not depend on the web app being up.
 *
 * ## One source failing is one source failing
 *
 * Every source is polled independently and its outcome is recorded on its own
 * row. A mailbox whose password expired does not stop the mailbox next to it,
 * and neither of them stops anybody uploading a PDF by hand. That is spec 8's
 * fourth rule — a failing adapter never blocks bookkeeping — and it is the
 * reason this loop swallows rather than rethrows.
 *
 * ## Peppol is not polled
 *
 * An access point delivers; it is not asked. A `peppol` row builds no adapter
 * and is skipped here, because its documents arrive at `POST /api/v1/inbox`
 * with the transmission id as the arrival's external id — the same doorway and
 * the same deduplication as everything else.
 */

export interface InboundPollSummary {
  readonly polled: number
  readonly filed: number
  readonly documents: number
  readonly failed: readonly {
    readonly name: string
    readonly failure: string
    /** Already failing before this poll, so the log can stay quiet about it. */
    readonly repeat: boolean
  }[]
}

/** The same choice the web app makes, from the same environment. */
function storeFor(): DocumentStore {
  return resolveDocumentStore(process.env)
}

/**
 * Poll every enabled source, once.
 *
 * Sequential rather than concurrent, and deliberately: polling ten mailboxes at
 * once buys nothing on a schedule that runs every few minutes, and it would put
 * ten write transactions against the same inbox in flight for no reason.
 */
export async function pollInboundSources(
  database: Database,
  store: DocumentStore = storeFor(),
): Promise<InboundPollSummary> {
  const rows = await withInboundSources(database, (repository) => repository.due())

  let filed = 0
  let documents = 0
  let polled = 0
  const failed: { name: string; failure: string; repeat: boolean }[] = []

  for (const row of rows) {
    const withSecret = await withInboundSources(database, (repository) =>
      repository.withSecret(row.entityId, row.id),
    )
    if (withSecret === null) continue

    const adapter = createInboundSource({
      kind: withSecret.kind,
      name: withSecret.name,
      config: withSecret.config,
      secret: decryptSecret(withSecret.secret),
    })
    // A Peppol row is configuration for a doorway that pushes, not a mailbox to
    // ask. Nothing to do here, and nothing wrong.
    if (adapter === null) continue

    polled += 1

    try {
      const result = await runInboundPoll({
        database,
        store,
        entityId: withSecret.entityId,
        sourceId: withSecret.id,
        source: adapter,
        cursor: withSecret.cursor,
        consecutiveFailures: withSecret.consecutiveFailures,
      })

      filed += result.filed
      documents += result.documents
      if (!result.ok) {
        failed.push({
          name: result.source,
          failure: result.failure ?? 'unknown',
          // Only the first failure of a run is worth a line in the log. After
          // that the row carries it, the screen shows it, and repeating it
          // every five minutes buries whatever broke this morning.
          repeat: withSecret.consecutiveFailures > 0,
        })
      }
    } catch (error: unknown) {
      // `runInboundPoll` records its own failures; this is the belt for the
      // braces. One mailbox must not take the run down with it.
      failed.push({
        name: row.name,
        failure: error instanceof Error ? error.message : String(error),
        repeat: row.consecutiveFailures > 0,
      })
    }
  }

  return { polled, filed, documents, failed }
}

/** The job body, which owns its own connection because it runs on a schedule. */
export async function pollInboundSourcesJob(databaseUrl: string): Promise<void> {
  const database = createDatabase({ url: databaseUrl, maxConnections: 2 })
  try {
    const summary = await pollInboundSources(database)
    if (summary.polled > 0) {
      console.info(
        `[worker] postvak: ${String(summary.polled)} bron(nen), ${String(summary.filed)} nieuwe berichten, ${String(summary.documents)} document(en)`,
      )
    }
    // New failures get a line each. Ones that were already failing get a
    // count, because six hundred repeats of the same message is not a log.
    const fresh = summary.failed.filter((failure) => !failure.repeat)
    for (const failure of fresh) {
      console.warn(`[worker] postvak: ${failure.name} — ${failure.failure}`)
    }

    const repeats = summary.failed.length - fresh.length
    if (repeats > 0) {
      console.info(
        `[worker] postvak: ${String(repeats)} bron(nen) falen nog steeds; zie Instellingen.`,
      )
    }
  } finally {
    await closeDatabase(database)
  }
}

export type { InboundSourceRow }
