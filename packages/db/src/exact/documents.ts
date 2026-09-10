import {
  ATTACHMENT_SELECT,
  DOCUMENT_SELECT,
  contentTypeFor,
  parseAttachment,
  parseDocument,
  sha256Hex,
  type DocumentStore,
  type ExactClient,
} from '@klopt/core'
import type { Database } from '../client.js'
import {
  withExactDocuments,
  type DocumentRunRow,
  type RunState,
} from '../repositories/exact-documents.js'
import { withInbox } from '../unit-of-work.js'

/**
 * Walking Exact's document archive into ours (spec 13).
 *
 * The rest of the Exact import is nine requests and one transaction. This is
 * the other kind of work: ten years of scanned invoices, tens of thousands of
 * files, several gigabytes, against a daily rate limit. It cannot be a request
 * and it cannot be one transaction.
 *
 * So it is a **bounded batch**. Each run of this function does a limited amount
 * of work, writes down where it got to, and returns. The worker calls it again
 * on the next tick. That makes it resumable across restarts, interruptible when
 * the rate limit runs low, and — because progress is a row rather than a
 * variable — visible on a screen while it happens.
 *
 * ## Not the inbox
 *
 * `receiveDocument` is the purchase inbox's path and it adds an inbox item.
 * That is right for something that just arrived and wrong for an archive:
 * nobody wants fifty thousand historical invoices queued for triage. These land
 * as documents with their provenance and nothing to action.
 *
 * ## The skip list is the point of `exact_attachments`
 *
 * Documents are content-addressed, so re-storing one is cheap. Re-*downloading*
 * one is not: a resumed run without a skip list pulls the whole archive over
 * the wire again to discover, by hash, that it already had it.
 */

export interface DocumentBatchOptions {
  readonly database: Database
  readonly store: DocumentStore
  readonly client: ExactClient
  readonly run: DocumentRunRow
  /** Attachments to fetch before saving and returning. */
  readonly limit?: number
  /**
   * Stop when Exact's remaining daily budget falls below this.
   *
   * Leaving room on purpose: the rest of the product still needs to talk to
   * Exact today, and an import that spends the last request is one that breaks
   * the dry run somebody is trying to look at.
   */
  readonly reserveRequests?: number
}

export interface DocumentBatchResult {
  readonly state: RunState
  readonly documentsSeen: number
  readonly attachmentsStored: number
  readonly attachmentsSkipped: number
  readonly bytesStored: bigint
  readonly cursor: string | null
  readonly failure: string | null
}

const DEFAULT_LIMIT = 200
const DEFAULT_RESERVE = 200

/** Exact's own count of what is left today, when it has told us. */
function remainingBudget(client: ExactClient): number | null {
  const withLimit = client as ExactClient & {
    rateLimit?: () => { dailyRemaining: number | null } | null
  }
  return withLimit.rateLimit?.()?.dailyRemaining ?? null
}

export async function runExactDocumentBatch(
  options: DocumentBatchOptions,
): Promise<DocumentBatchResult> {
  const { database, store, client, run } = options
  const limit = options.limit ?? DEFAULT_LIMIT
  const reserve = options.reserveRequests ?? DEFAULT_RESERVE

  let documentsSeen = 0
  let attachmentsStored = 0
  let attachmentsSkipped = 0
  let bytesStored = 0n

  try {
    // One page of documents per call to this, plus its attachments. A page is
    // a thousand rows on the bulk endpoint, which is more than the attachment
    // limit will get through — so the cursor usually stays put and the next
    // tick picks up the same page's remaining attachments via the skip list.
    const page =
      run.cursor === null
        ? await client.page({
            division: run.divisionCode,
            path: 'bulk/Documents/Documents',
            select: [...DOCUMENT_SELECT],
            orderBy: 'DocumentDate desc',
          })
        : await client.nextPage(run.cursor)

    const documents = page.rows.map(parseDocument)
    documentsSeen = documents.length

    if (documents.length === 0) {
      return {
        state: 'done',
        documentsSeen,
        attachmentsStored,
        attachmentsSkipped,
        bytesStored,
        cursor: null,
        failure: null,
      }
    }

    // The attachments for this page's documents. Asked for by document id
    // rather than walking the whole attachment table, which on a large archive
    // is a second full scan for no reason.
    const wanted = new Set(documents.map((document) => document.id))
    const attachmentPage = await client.page({
      division: run.divisionCode,
      path: 'bulk/Documents/DocumentAttachments',
      select: [...ATTACHMENT_SELECT],
    })

    const attachments = attachmentPage.rows
      .map(parseAttachment)
      .filter((attachment) => wanted.has(attachment.documentId) && attachment.url !== null)

    const already = await withExactDocuments(database, (repository) =>
      repository.known(
        run.entityId,
        attachments.map((attachment) => attachment.id),
      ),
    )

    const byDocument = new Map(documents.map((document) => [document.id, document]))
    let fetched = 0

    for (const attachment of attachments) {
      if (already.has(attachment.id)) {
        attachmentsSkipped += 1
        continue
      }

      if (fetched >= limit) {
        // Enough for one batch. The cursor stays where it is, so the next tick
        // sees this page again and the skip list carries what was done.
        return {
          state: 'running',
          documentsSeen,
          attachmentsStored,
          attachmentsSkipped,
          bytesStored,
          cursor: run.cursor,
          failure: null,
        }
      }

      const budget = remainingBudget(client)
      if (budget !== null && budget <= reserve) {
        // Not an error. Tomorrow's budget will finish it, and stopping with
        // room to spare leaves the rest of the product able to reach Exact.
        return {
          state: 'paused',
          documentsSeen,
          attachmentsStored,
          attachmentsSkipped,
          bytesStored,
          cursor: run.cursor,
          failure: `Paused with ${String(budget)} Exact requests left today.`,
        }
      }

      const bytes = await client.download(attachment.url!)
      fetched += 1

      const document = byDocument.get(attachment.documentId)
      const contentType = contentTypeFor(attachment.fileName)
      const stored = await store.put(bytes, { contentType })

      const recorded = await withInbox(database, ({ inbox }) =>
        inbox.recordDocument({
          entityId: run.entityId,
          sha256: stored.sha256 ?? sha256Hex(bytes),
          sizeBytes: bytes.byteLength,
          contentType,
          filename: attachment.fileName,
        }),
      )

      await withExactDocuments(database, (repository) =>
        repository.remember({
          entityId: run.entityId,
          exactAttachmentId: attachment.id,
          exactDocumentId: attachment.documentId,
          documentId: recorded.id,
          subject: document?.subject ?? null,
          documentDate: document?.documentDate ?? null,
        }),
      )

      attachmentsStored += 1
      bytesStored += BigInt(bytes.byteLength)
    }

    // Every attachment on this page is here. Move on, or finish.
    return {
      state: page.next === null ? 'done' : 'running',
      documentsSeen,
      attachmentsStored,
      attachmentsSkipped,
      bytesStored,
      cursor: page.next,
      failure: null,
    }
  } catch (error: unknown) {
    // The batch keeps what it managed. A run that fell over on attachment four
    // hundred should not lose the first three hundred and ninety-nine.
    return {
      state: 'failed',
      documentsSeen,
      attachmentsStored,
      attachmentsSkipped,
      bytesStored,
      cursor: run.cursor,
      failure: error instanceof Error ? error.message : String(error),
    }
  }
}
