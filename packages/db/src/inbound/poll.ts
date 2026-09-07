import type { DocumentStore, InboundSource } from '@klopt/core'
import type { Database } from '../client.js'
import { withInboundSources } from '../unit-of-work.js'
import { ingestInboundMessage, type IngestedMessage } from './receive.js'

/**
 * One poll of one source, end to end.
 *
 * The order here is the whole design, and it is the order that loses nothing:
 *
 *   1. **Poll.** A source that cannot be reached returns its reason rather than
 *      throwing. Nothing is written and the cursor does not move.
 *   2. **Ingest, message by message.** Each arrival commits on its own. A poll
 *      that took forty messages and failed on the thirty-first keeps thirty.
 *   3. **Record the outcome**, worked or not, so a mailbox that has been
 *      refusing a password for a week says so on a screen.
 *   4. **Acknowledge, last.** Only what actually committed, and only after it
 *      has. A message moved to a processed folder before its documents are
 *      stored is a message nobody will ever see again.
 *
 * Step 4 after step 2 means a crash in between leaves the message where it was
 * and the next poll takes it again. That duplicate is harmless because the
 * arrival's external id has already been written — at-least-once is the correct
 * failure direction here, because the other one loses invoices.
 */

export interface InboundPollResult {
  readonly source: string
  readonly ok: boolean
  readonly failure: string | null
  readonly messages: readonly IngestedMessage[]
  /** Arrivals that were new. The rest had been taken before. */
  readonly filed: number
  /** Documents that reached the queue. */
  readonly documents: number
}

export async function runInboundPoll(request: {
  readonly database: Database
  readonly store: DocumentStore
  readonly entityId: string
  readonly sourceId: string
  readonly source: InboundSource
  readonly cursor: string | null
}): Promise<InboundPollResult> {
  const { database, source } = request

  const availability = source.available()
  if (!availability.ok) {
    await record(database, request.sourceId, {
      ok: false,
      cursor: request.cursor,
      messageCount: 0,
      failure: availability.reason,
    })
    return {
      source: source.name,
      ok: false,
      failure: availability.reason,
      messages: [],
      filed: 0,
      documents: 0,
    }
  }

  const poll = await source.poll(request.cursor)

  if (!poll.ok) {
    await record(database, request.sourceId, {
      ok: false,
      cursor: request.cursor,
      messageCount: 0,
      failure: poll.failure,
    })
    return {
      source: source.name,
      ok: false,
      failure: poll.failure,
      messages: [],
      filed: 0,
      documents: 0,
    }
  }

  const ingested: IngestedMessage[] = []
  const committed: string[] = []
  let failure: string | null = null

  for (const message of poll.messages) {
    try {
      const result = await ingestInboundMessage(database, request.store, {
        entityId: request.entityId,
        message,
      })
      ingested.push(result)
      committed.push(message.externalId)
    } catch (error: unknown) {
      // Stop at the first one that would not commit rather than carrying on:
      // whatever is wrong is likely wrong for the rest, and the cursor must not
      // move past a message nobody stored. What did commit stays committed.
      failure = error instanceof Error ? error.message : String(error)
      break
    }
  }

  // The cursor only advances on a clean run. Advancing past a message that did
  // not commit would lose it, and the duplicate that comes from not advancing
  // costs nothing.
  const cursor = failure === null ? poll.cursor : request.cursor

  await record(database, request.sourceId, {
    ok: failure === null,
    cursor,
    messageCount: ingested.length,
    failure,
  })

  // Last, and only what committed.
  if (committed.length > 0) await source.acknowledge(committed)

  return {
    source: source.name,
    ok: failure === null,
    failure,
    messages: ingested,
    filed: ingested.filter((entry) => !entry.alreadyTaken).length,
    documents: ingested.reduce((sum, entry) => sum + entry.documents.length, 0),
  }
}

async function record(
  database: Database,
  sourceId: string,
  outcome: {
    readonly ok: boolean
    readonly cursor: string | null
    readonly messageCount: number
    readonly failure: string | null
  },
): Promise<void> {
  await withInboundSources(database, (repository) =>
    repository.recordPoll({ sourceId, ...outcome }),
  )
}
