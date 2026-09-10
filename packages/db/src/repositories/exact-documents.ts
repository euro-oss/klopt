import { uuidv7 } from '@klopt/core'
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm'
import type { Database, Transaction } from '../client.js'
import { exactAttachments, exactDocumentRuns } from '../schema/documents.js'

/**
 * The state of a walk through Exact's document archive (spec 13).
 *
 * Two tables and both earn their place. The run is what makes the job
 * resumable and its progress visible; the attachment rows are the skip list,
 * without which a resumed run downloads the whole archive again to discover by
 * hash that it already has it.
 */

/**
 * How long a claim is good for before another worker may take the run.
 *
 * Longer than a batch, short enough that a crashed worker is not a lost
 * afternoon.
 */
export const CLAIM_LEASE_MS = 10 * 60_000

export type RunState = 'pending' | 'running' | 'paused' | 'done' | 'failed'

export interface DocumentRunRow {
  readonly id: string
  readonly entityId: string
  readonly divisionCode: number
  readonly state: RunState
  readonly cursor: string | null
  readonly documentsSeen: number
  readonly attachmentsStored: number
  readonly attachmentsSkipped: number
  readonly bytesStored: bigint
  readonly requestedAt: string
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly lastError: string | null
}

const COLUMNS = {
  id: exactDocumentRuns.id,
  entityId: exactDocumentRuns.entityId,
  divisionCode: exactDocumentRuns.divisionCode,
  state: exactDocumentRuns.state,
  cursor: exactDocumentRuns.cursor,
  documentsSeen: exactDocumentRuns.documentsSeen,
  attachmentsStored: exactDocumentRuns.attachmentsStored,
  attachmentsSkipped: exactDocumentRuns.attachmentsSkipped,
  bytesStored: exactDocumentRuns.bytesStored,
  requestedAt: exactDocumentRuns.requestedAt,
  startedAt: exactDocumentRuns.startedAt,
  finishedAt: exactDocumentRuns.finishedAt,
  lastError: exactDocumentRuns.lastError,
}

function toRow(row: {
  id: string
  entityId: string
  divisionCode: number
  state: string
  cursor: string | null
  documentsSeen: number
  attachmentsStored: number
  attachmentsSkipped: number
  bytesStored: bigint
  requestedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  lastError: string | null
}): DocumentRunRow {
  return {
    ...row,
    state: row.state as RunState,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }
}

export class ExactDocumentRepository {
  constructor(private readonly tx: Transaction) {}

  /**
   * Ask for a run, or join the one already going.
   *
   * Never two walks over the same archive: the unique index on `entity_id` is
   * the guarantee and this is the shape that respects it. A finished run is
   * reset rather than duplicated, so "import the documents again" means what
   * somebody expects — pick up anything new — instead of failing on a
   * constraint.
   */
  async request(request: {
    readonly entityId: string
    readonly divisionCode: number
    readonly requestedBy: string | null
  }): Promise<DocumentRunRow> {
    const [row] = await this.tx
      .insert(exactDocumentRuns)
      .values({
        id: uuidv7(),
        entityId: request.entityId,
        divisionCode: request.divisionCode,
        requestedBy: request.requestedBy,
        state: 'pending',
      })
      .onConflictDoUpdate({
        target: exactDocumentRuns.entityId,
        // Only a run that has stopped is restarted. One in flight is joined,
        // which is what `where` here means: the update simply does not happen.
        set: {
          state: 'pending',
          divisionCode: request.divisionCode,
          requestedBy: request.requestedBy,
          requestedAt: new Date(),
          startedAt: null,
          finishedAt: null,
          lastError: null,
          cursor: null,
          updatedAt: new Date(),
        },
        setWhere: inArray(exactDocumentRuns.state, ['done', 'failed']),
      })
      .returning(COLUMNS)

    if (row !== undefined) return toRow(row)

    // The conflict matched a run that is still going, so nothing was written.
    const existing = await this.find(request.entityId)
    if (existing === null) throw new Error('The document run vanished between insert and read.')
    return existing
  }

  async find(entityId: string): Promise<DocumentRunRow | null> {
    const [row] = await this.tx
      .select(COLUMNS)
      .from(exactDocumentRuns)
      .where(eq(exactDocumentRuns.entityId, entityId))
      .limit(1)

    return row === undefined ? null : toRow(row)
  }

  /**
   * Claim one run to work on.
   *
   * `pending` or `paused`, oldest first. The update is the claim: two workers
   * racing for the same run means exactly one of them sees a row come back,
   * because the `where` no longer matches once the first has written.
   */
  async claim(now: Date): Promise<DocumentRunRow | null> {
    /**
     * A claim is a lease, not a flag.
     *
     * `running` means "a worker has this". If that worker dies mid-batch —
     * a deploy, a crash, a laptop lid — the row stays `running` and nothing
     * ever picks it up again. Three of them were sitting in a development
     * database before this existed, permanently stuck.
     *
     * So a `running` row whose last update is older than the lease is fair
     * game. Ten minutes: comfortably longer than a batch, short enough that a
     * restart is not a lost afternoon.
     */
    const staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS)

    const [candidate] = await this.tx
      .select({ id: exactDocumentRuns.id })
      .from(exactDocumentRuns)
      .where(
        or(
          inArray(exactDocumentRuns.state, ['pending', 'paused']),
          and(eq(exactDocumentRuns.state, 'running'), lt(exactDocumentRuns.updatedAt, staleBefore)),
        ),
      )
      .orderBy(exactDocumentRuns.requestedAt)
      .limit(1)

    if (candidate === undefined) return null

    // The update is the claim: two workers racing for the same row means one
    // of them sees nothing come back, because the `where` no longer matches.
    const [claimed] = await this.tx
      .update(exactDocumentRuns)
      .set({ state: 'running', startedAt: now, updatedAt: now })
      .where(
        and(
          eq(exactDocumentRuns.id, candidate.id),
          or(
            inArray(exactDocumentRuns.state, ['pending', 'paused']),
            and(
              eq(exactDocumentRuns.state, 'running'),
              lt(exactDocumentRuns.updatedAt, staleBefore),
            ),
          ),
        ),
      )
      .returning(COLUMNS)

    return claimed === undefined ? null : toRow(claimed)
  }

  /** Save progress mid-walk, without finishing it. */
  async advance(request: {
    readonly id: string
    readonly cursor: string | null
    readonly documentsSeen: number
    readonly attachmentsStored: number
    readonly attachmentsSkipped: number
    readonly bytesStored: bigint
    readonly state: RunState
    readonly lastError?: string | null
  }): Promise<void> {
    const finished = request.state === 'done' || request.state === 'failed'

    await this.tx
      .update(exactDocumentRuns)
      .set({
        cursor: request.cursor,
        state: request.state,
        // Added to rather than replaced: a batch reports what it did, not what
        // every batch before it did.
        documentsSeen: sql`${exactDocumentRuns.documentsSeen} + ${request.documentsSeen}`,
        attachmentsStored: sql`${exactDocumentRuns.attachmentsStored} + ${request.attachmentsStored}`,
        attachmentsSkipped: sql`${exactDocumentRuns.attachmentsSkipped} + ${request.attachmentsSkipped}`,
        bytesStored: sql`${exactDocumentRuns.bytesStored} + ${request.bytesStored}`,
        lastError: request.lastError ?? null,
        ...(finished ? { finishedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(exactDocumentRuns.id, request.id))
  }

  /** Which of these attachments are already here. */
  async known(entityId: string, attachmentIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (attachmentIds.length === 0) return new Set()

    const rows = await this.tx
      .select({ exactAttachmentId: exactAttachments.exactAttachmentId })
      .from(exactAttachments)
      .where(
        and(
          eq(exactAttachments.entityId, entityId),
          inArray(exactAttachments.exactAttachmentId, [...attachmentIds]),
        ),
      )

    return new Set(rows.map((row) => row.exactAttachmentId))
  }

  async remember(request: {
    readonly entityId: string
    readonly exactAttachmentId: string
    readonly exactDocumentId: string
    readonly documentId: string
    readonly subject: string | null
    readonly documentDate: string | null
  }): Promise<void> {
    await this.tx
      .insert(exactAttachments)
      .values({ id: uuidv7(), ...request })
      // A re-run that raced its own skip list writes the same row twice.
      .onConflictDoNothing()
  }
}

export async function withExactDocuments<T>(
  database: Database,
  work: (repository: ExactDocumentRepository) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => work(new ExactDocumentRepository(tx)))
}
