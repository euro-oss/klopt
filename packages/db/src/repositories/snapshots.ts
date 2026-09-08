import { uuidv7, type SealedSnapshot, type SnapshotDocument, type SnapshotDrift } from '@klopt/core'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { documents, sealedSnapshots } from '../schema/documents.js'
import { journalEntries } from '../schema/ledger.js'

/**
 * Sealed snapshots, against the database (spec 7.6).
 *
 * Two things here are worth reading twice.
 *
 * **The seal chain.** Each snapshot records the previous one's seal, for the
 * same reason the journal chains its entries: removing a snapshot from the
 * middle of the sequence becomes visible rather than leaving a tidy gap.
 * `latestSeal` is what supplies it, and it is read inside the same transaction
 * that writes the new row so two concurrent seals cannot both claim the same
 * predecessor.
 *
 * **What goes into the manifest.** Every document the administration has ever
 * held, including the ones since deleted under their term. Their absence would
 * read as "never here"; what actually happened — kept the statutory seven
 * years, then deliberately removed, with a reason in the audit log — is the
 * fact worth being able to prove.
 */

export interface SnapshotRow {
  readonly id: string
  readonly fiscalYear: string
  readonly sealedAt: string
  readonly sealedBy: string
  readonly chainHead: string | null
  readonly entryCount: number
  readonly auditFileSha256: string
  readonly auditFileLineCount: number
  readonly manifestSha256: string
  readonly manifest: string
  readonly seal: string
  readonly previousSeal: string | null
  readonly documentCount: number
  readonly deletedDocumentCount: number
  readonly totalBytes: bigint
  readonly verifiedAt: string | null
  readonly verifiedOk: boolean | null
  readonly drift: unknown
}

const COLUMNS = {
  id: sealedSnapshots.id,
  fiscalYear: sealedSnapshots.fiscalYear,
  sealedAt: sealedSnapshots.sealedAt,
  sealedBy: sealedSnapshots.sealedBy,
  chainHead: sealedSnapshots.chainHead,
  entryCount: sealedSnapshots.entryCount,
  auditFileSha256: sealedSnapshots.auditFileSha256,
  auditFileLineCount: sealedSnapshots.auditFileLineCount,
  manifestSha256: sealedSnapshots.manifestSha256,
  manifest: sealedSnapshots.manifest,
  seal: sealedSnapshots.seal,
  previousSeal: sealedSnapshots.previousSeal,
  documentCount: sealedSnapshots.documentCount,
  deletedDocumentCount: sealedSnapshots.deletedDocumentCount,
  totalBytes: sealedSnapshots.totalBytes,
  verifiedAt: sealedSnapshots.verifiedAt,
  verifiedOk: sealedSnapshots.verifiedOk,
  drift: sealedSnapshots.drift,
}

function toRow(row: {
  sealedAt: Date
  verifiedAt: Date | null
  [key: string]: unknown
}): SnapshotRow {
  return {
    ...row,
    sealedAt: row.sealedAt.toISOString(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
  } as SnapshotRow
}

export class SnapshotRepository {
  constructor(private readonly tx: Transaction) {}

  /**
   * Everything the manifest covers.
   *
   * Deleted documents included, and `retain_until` with them, so a snapshot
   * records not just what was held but how long it was going to be.
   */
  async documentsFor(entityId: string): Promise<SnapshotDocument[]> {
    const rows = await this.tx
      .select({
        sha256: documents.sha256,
        sizeBytes: documents.sizeBytes,
        retainUntil: documents.retainUntil,
        deletedAt: documents.deletedAt,
      })
      .from(documents)
      .where(eq(documents.entityId, entityId))

    return rows.map((row) => ({
      sha256: row.sha256,
      sizeBytes: row.sizeBytes,
      retainUntil: row.retainUntil,
      deleted: row.deletedAt !== null,
    }))
  }

  /** The chain head and its length, which is what one hash has to cover. */
  async chainState(
    entityId: string,
  ): Promise<{ readonly head: string | null; readonly entryCount: number }> {
    const [row] = await this.tx
      .select({
        head: journalEntries.hash,
        sequence: journalEntries.chainSequence,
      })
      .from(journalEntries)
      .where(eq(journalEntries.entityId, entityId))
      .orderBy(desc(journalEntries.chainSequence))
      .limit(1)

    const [counted] = await this.tx
      .select({ total: sql<string>`count(*)` })
      .from(journalEntries)
      .where(eq(journalEntries.entityId, entityId))

    return { head: row?.head ?? null, entryCount: Number(counted?.total ?? '0') }
  }

  /** The most recent seal, which the next snapshot chains onto. */
  async latestSeal(entityId: string): Promise<string | null> {
    const [row] = await this.tx
      .select({ seal: sealedSnapshots.seal })
      .from(sealedSnapshots)
      .where(eq(sealedSnapshots.entityId, entityId))
      .orderBy(desc(sealedSnapshots.sealedAt), desc(sealedSnapshots.id))
      .limit(1)

    return row?.seal ?? null
  }

  async record(request: {
    readonly entityId: string
    readonly sealedBy: string
    readonly snapshot: SealedSnapshot
    readonly manifestSha256: string
  }): Promise<string> {
    const id = uuidv7()
    const { snapshot } = request

    await this.tx.insert(sealedSnapshots).values({
      id,
      entityId: request.entityId,
      fiscalYear: snapshot.fiscalYear,
      sealedAt: new Date(snapshot.sealedAt),
      sealedBy: request.sealedBy,
      chainHead: snapshot.chainHead,
      entryCount: snapshot.entryCount,
      auditFileSha256: snapshot.auditFileSha256,
      auditFileLineCount: snapshot.auditFileLineCount,
      manifestSha256: request.manifestSha256,
      manifest: snapshot.manifest,
      seal: snapshot.seal,
      previousSeal: snapshot.previousSeal,
      documentCount: snapshot.documentCount,
      deletedDocumentCount: snapshot.deletedDocumentCount,
      totalBytes: snapshot.totalBytes,
    })

    return id
  }

  async list(entityId: string): Promise<SnapshotRow[]> {
    const rows = await this.tx
      .select(COLUMNS)
      .from(sealedSnapshots)
      .where(eq(sealedSnapshots.entityId, entityId))
      .orderBy(desc(sealedSnapshots.sealedAt), desc(sealedSnapshots.id))

    return rows.map(toRow)
  }

  async find(entityId: string, snapshotId: string): Promise<SnapshotRow | null> {
    const [row] = await this.tx
      .select(COLUMNS)
      .from(sealedSnapshots)
      .where(and(eq(sealedSnapshots.entityId, entityId), eq(sealedSnapshots.id, snapshotId)))
      .limit(1)

    return row === undefined ? null : toRow(row)
  }

  /**
   * Record what a check found.
   *
   * The only writable part of a snapshot: the outcome is not something that was
   * sealed, it is what somebody found when they looked. The database enforces
   * that distinction — see the trigger in `0021_sealed_snapshots.sql`.
   */
  async recordVerification(request: {
    readonly entityId: string
    readonly snapshotId: string
    readonly ok: boolean
    readonly drift: readonly SnapshotDrift[]
  }): Promise<void> {
    await this.tx
      .update(sealedSnapshots)
      .set({
        verifiedAt: new Date(),
        verifiedOk: request.ok,
        drift: request.drift,
      })
      .where(
        and(
          eq(sealedSnapshots.entityId, request.entityId),
          eq(sealedSnapshots.id, request.snapshotId),
        ),
      )
  }

  /**
   * Book years with postings and no snapshot yet.
   *
   * What the scheduled job asks for. A year nobody has posted into does not
   * need sealing, and a year already sealed is only resealed on request —
   * sealing the same unchanged year nightly would bury the one that changed.
   */
  async yearsNeedingSnapshot(entityId: string): Promise<string[]> {
    const rows = await this.tx
      .select({ year: sql<string>`to_char(${journalEntries.bookingDate}, 'YYYY')` })
      .from(journalEntries)
      .where(eq(journalEntries.entityId, entityId))
      .groupBy(sql`to_char(${journalEntries.bookingDate}, 'YYYY')`)

    const sealed = await this.tx
      .selectDistinct({ year: sealedSnapshots.fiscalYear })
      .from(sealedSnapshots)
      .where(eq(sealedSnapshots.entityId, entityId))

    const already = new Set(sealed.map((row) => row.year))
    return rows
      .map((row) => row.year)
      .filter((year) => !already.has(year))
      .sort()
  }

  /** Entities with any postings at all, for the scheduled sweep. */
  async entitiesWithPostings(): Promise<string[]> {
    const rows = await this.tx
      .selectDistinct({ entityId: journalEntries.entityId })
      .from(journalEntries)
      .where(isNull(journalEntries.reversesEntryId))

    return rows.map((row) => row.entityId)
  }
}
