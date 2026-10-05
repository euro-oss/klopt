import { uuidv7 } from '@klopt/core'
import { and, eq, inArray, lt, or } from 'drizzle-orm'
import type { Database, Transaction } from '../client.js'
import {
  moneybirdAttachments,
  moneybirdImportRuns,
  moneybirdImportedIds,
} from '../schema/documents.js'

export const MONEYBIRD_CLAIM_LEASE_MS = 10 * 60_000

export type MoneybirdRunState = 'pending' | 'running' | 'paused' | 'done' | 'failed'

export interface MoneybirdImportRunRow {
  readonly id: string
  readonly entityId: string
  readonly administrationId: string
  readonly state: MoneybirdRunState
  readonly report: unknown
  readonly requestedAt: string
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly lastError: string | null
}

export class MoneybirdImportRepository {
  constructor(private readonly tx: Transaction) {}

  async find(entityId: string): Promise<MoneybirdImportRunRow | null> {
    const [row] = await this.tx
      .select()
      .from(moneybirdImportRuns)
      .where(eq(moneybirdImportRuns.entityId, entityId))
      .limit(1)
    return row === undefined ? null : toRun(row)
  }

  async request(request: {
    readonly entityId: string
    readonly administrationId: string
    readonly requestedBy: string
  }): Promise<MoneybirdImportRunRow> {
    const existing = await this.find(request.entityId)
    if (existing !== null && (existing.state === 'pending' || existing.state === 'running')) {
      return existing
    }

    if (existing !== null) {
      await this.tx
        .update(moneybirdImportRuns)
        .set({
          administrationId: request.administrationId,
          state: 'pending',
          report: null,
          requestedBy: request.requestedBy,
          requestedAt: new Date(),
          startedAt: null,
          finishedAt: null,
          lastError: null,
        })
        .where(eq(moneybirdImportRuns.entityId, request.entityId))
      return (await this.find(request.entityId))!
    }

    const id = uuidv7()
    await this.tx.insert(moneybirdImportRuns).values({
      id,
      entityId: request.entityId,
      administrationId: request.administrationId,
      requestedBy: request.requestedBy,
    })
    return (await this.find(request.entityId))!
  }

  async claim(now: Date): Promise<MoneybirdImportRunRow | null> {
    const stale = new Date(now.getTime() - MONEYBIRD_CLAIM_LEASE_MS)
    const [row] = await this.tx
      .select()
      .from(moneybirdImportRuns)
      .where(
        or(
          eq(moneybirdImportRuns.state, 'pending'),
          and(eq(moneybirdImportRuns.state, 'running'), lt(moneybirdImportRuns.startedAt, stale)),
        ),
      )
      .orderBy(moneybirdImportRuns.requestedAt)
      .limit(1)

    if (row === undefined) return null

    await this.tx
      .update(moneybirdImportRuns)
      .set({ state: 'running', startedAt: now, lastError: null })
      .where(eq(moneybirdImportRuns.id, row.id))

    return { ...toRun(row), state: 'running', startedAt: now.toISOString() }
  }

  async finish(request: {
    readonly id: string
    readonly state: MoneybirdRunState
    readonly report: unknown
    readonly lastError: string | null
  }): Promise<void> {
    await this.tx
      .update(moneybirdImportRuns)
      .set({
        state: request.state,
        report: request.report,
        lastError: request.lastError,
        finishedAt: request.state === 'running' || request.state === 'pending' ? null : new Date(),
      })
      .where(eq(moneybirdImportRuns.id, request.id))
  }

  async knownExternalIds(entityId: string): Promise<readonly string[]> {
    const rows = await this.tx
      .select({ externalId: moneybirdImportedIds.externalId })
      .from(moneybirdImportedIds)
      .where(eq(moneybirdImportedIds.entityId, entityId))
    return rows.map((row) => row.externalId)
  }

  async remember(request: {
    readonly entityId: string
    readonly externalId: string
    readonly kind: string
    readonly journalEntryId: string | null
  }): Promise<void> {
    await this.tx
      .insert(moneybirdImportedIds)
      .values({
        entityId: request.entityId,
        externalId: request.externalId,
        kind: request.kind,
        journalEntryId: request.journalEntryId,
      })
      .onConflictDoNothing()
  }

  async knownAttachments(
    entityId: string,
    ids: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set()
    const rows = await this.tx
      .select({ id: moneybirdAttachments.moneybirdAttachmentId })
      .from(moneybirdAttachments)
      .where(
        and(
          eq(moneybirdAttachments.entityId, entityId),
          inArray(moneybirdAttachments.moneybirdAttachmentId, [...ids]),
        ),
      )
    return new Set(rows.map((row) => row.id))
  }

  async rememberAttachment(request: {
    readonly entityId: string
    readonly moneybirdAttachmentId: string
    readonly moneybirdDocumentId: string
    readonly documentId: string
  }): Promise<void> {
    await this.tx
      .insert(moneybirdAttachments)
      .values({
        entityId: request.entityId,
        moneybirdAttachmentId: request.moneybirdAttachmentId,
        moneybirdDocumentId: request.moneybirdDocumentId,
        documentId: request.documentId,
      })
      .onConflictDoNothing()
  }
}

function toRun(row: {
  id: string
  entityId: string
  administrationId: string
  state: string
  report: unknown
  requestedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  lastError: string | null
}): MoneybirdImportRunRow {
  return {
    id: row.id,
    entityId: row.entityId,
    administrationId: row.administrationId,
    state: row.state as MoneybirdRunState,
    report: row.report,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    lastError: row.lastError,
  }
}

export async function withMoneybirdImport<T>(
  database: Database,
  work: (repository: MoneybirdImportRepository) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => work(new MoneybirdImportRepository(tx)))
}