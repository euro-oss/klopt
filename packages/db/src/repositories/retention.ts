import { retainUntil, type RetentionClass } from '@klopt/core'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { documentLinks, documents } from '../schema/documents.js'
import { entities, fiscalYears, journalEntries } from '../schema/ledger.js'
import { purchaseInvoices } from '../schema/purchase.js'
import { salesInvoices } from '../schema/sales.js'

/**
 * The bewaarplicht, against the database (spec 7.6).
 *
 * The interesting part is `dateDocuments`: a document's retention term is
 * counted from the end of the book year it belongs to, and a document does not
 * know its book year. It knows what it is *evidence for* — an invoice, a
 * purchase invoice, a journal entry — and those know their dates. So the term
 * is derived through `document_links` and stored, rather than recomputed on
 * every read, because "how long must this be kept" is an answer somebody may
 * have relied on and it should not change silently under them.
 *
 * It is recomputed when new evidence arrives, though: a document linked to a
 * second subject in a later year gets the longer term, since keeping it for the
 * shorter one would throw away the evidence for the later.
 */

/** A document whose term is now known, and therefore lockable in the store. */
export interface DatedDocument {
  readonly documentId: string
  readonly sha256: string
  readonly retainUntil: string
}

export interface RetentionDocumentRow {
  readonly id: string
  readonly sha256: string
  readonly filename: string | null
  readonly contentType: string
  readonly sizeBytes: number
  readonly firstSeenAt: string
  readonly retentionClass: RetentionClass
  readonly retainUntil: string | null
  readonly retentionFiscalYear: string | null
  readonly legalHold: boolean
  readonly legalHoldReason: string | null
  readonly deletedAt: string | null
  readonly deletedReason: string | null
  /** How many things this is evidence for. Zero means nothing points at it. */
  readonly linkCount: number
}

const COLUMNS = {
  id: documents.id,
  sha256: documents.sha256,
  filename: documents.filename,
  contentType: documents.contentType,
  sizeBytes: documents.sizeBytes,
  firstSeenAt: documents.firstSeenAt,
  retentionClass: documents.retentionClass,
  retainUntil: documents.retainUntil,
  retentionFiscalYear: documents.retentionFiscalYear,
  legalHold: documents.legalHold,
  legalHoldReason: documents.legalHoldReason,
  deletedAt: documents.deletedAt,
  deletedReason: documents.deletedReason,
}

export class RetentionRepository {
  constructor(private readonly tx: Transaction) {}

  /** Whether the whole administration is held, and why. */
  async entityHold(
    entityId: string,
  ): Promise<{ readonly held: boolean; readonly reason: string | null }> {
    const [row] = await this.tx
      .select({ held: entities.legalHold, reason: entities.legalHoldReason })
      .from(entities)
      .where(eq(entities.id, entityId))
      .limit(1)

    return { held: row?.held ?? false, reason: row?.reason ?? null }
  }

  async setEntityHold(entityId: string, held: boolean, reason: string | null): Promise<void> {
    await this.tx
      .update(entities)
      .set({ legalHold: held, legalHoldReason: reason, updatedAt: new Date().toISOString() })
      .where(eq(entities.id, entityId))
  }

  async list(entityId: string): Promise<RetentionDocumentRow[]> {
    const counts = this.tx
      .select({
        documentId: documentLinks.documentId,
        total: sql<string>`count(*)`.as('links'),
      })
      .from(documentLinks)
      .where(eq(documentLinks.entityId, entityId))
      .groupBy(documentLinks.documentId)
      .as('links')

    const rows = await this.tx
      .select({ ...COLUMNS, linkCount: counts.total })
      .from(documents)
      .leftJoin(counts, eq(counts.documentId, documents.id))
      .where(eq(documents.entityId, entityId))
      .orderBy(asc(documents.retainUntil), asc(documents.firstSeenAt))

    return rows.map((row) => ({
      ...row,
      firstSeenAt: row.firstSeenAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      linkCount: Number(row.linkCount ?? '0'),
    }))
  }

  /**
   * Work out which book year each document belongs to, and store the term.
   *
   * A document reaches a book year through what it is evidence for. Three
   * kinds carry a date today — a sales invoice, a purchase invoice and a
   * journal entry — and the **latest** of them wins when a document is evidence
   * for several: keeping it for the earliest would throw away the evidence for
   * the later one while it still mattered.
   *
   * Returns the terms it wrote, so a caller can push them at the storage.
   * Idempotent by construction: it writes the term it computes, and computing
   * it again from the same links produces the same answer.
   */
  async dateDocuments(entityId: string): Promise<readonly DatedDocument[]> {
    const dated = await this.tx
      .select({
        documentId: documentLinks.documentId,
        retentionClass: documents.retentionClass,
        // The end of the book year covering the subject's own date. `max`
        // because one document can be evidence for several things, and the
        // longest obligation is the one that binds.
        endsOn: sql<string | null>`max(${fiscalYears.endsOn})`,
        code: sql<string | null>`max(${fiscalYears.code})`,
      })
      .from(documentLinks)
      .innerJoin(documents, eq(documents.id, documentLinks.documentId))
      .leftJoin(
        salesInvoices,
        and(
          eq(documentLinks.subjectKind, 'sales_invoice'),
          eq(salesInvoices.id, documentLinks.subjectId),
        ),
      )
      .leftJoin(
        purchaseInvoices,
        and(
          eq(documentLinks.subjectKind, 'purchase_invoice'),
          eq(purchaseInvoices.id, documentLinks.subjectId),
        ),
      )
      .leftJoin(
        journalEntries,
        and(
          eq(documentLinks.subjectKind, 'journal_entry'),
          eq(journalEntries.id, documentLinks.subjectId),
        ),
      )
      .leftJoin(
        fiscalYears,
        and(
          eq(fiscalYears.entityId, entityId),
          sql`coalesce(${salesInvoices.issueDate}, ${purchaseInvoices.invoiceDate}, ${journalEntries.bookingDate})
              between ${fiscalYears.startsOn} and ${fiscalYears.endsOn}`,
        ),
      )
      .where(and(eq(documentLinks.entityId, entityId), isNull(documents.deletedAt)))
      .groupBy(documentLinks.documentId, documents.retentionClass)

    const written: DatedDocument[] = []
    for (const row of dated) {
      if (row.endsOn === null || row.code === null) continue

      const until = retainUntil(row.endsOn, row.retentionClass)
      const [updated] = await this.tx
        .update(documents)
        .set({ retainUntil: until, retentionFiscalYear: row.code })
        .where(and(eq(documents.entityId, entityId), eq(documents.id, row.documentId)))
        .returning({ sha256: documents.sha256 })

      if (updated !== undefined) {
        written.push({ documentId: row.documentId, sha256: updated.sha256, retainUntil: until })
      }
    }

    return written
  }

  async setDocumentHold(request: {
    readonly entityId: string
    readonly documentIds: readonly string[]
    readonly held: boolean
    readonly reason: string | null
  }): Promise<number> {
    if (request.documentIds.length === 0) return 0

    const updated = await this.tx
      .update(documents)
      .set({ legalHold: request.held, legalHoldReason: request.reason })
      .where(
        and(
          eq(documents.entityId, request.entityId),
          inArray(documents.id, [...request.documentIds]),
        ),
      )
      .returning({ id: documents.id })

    return updated.length
  }

  async setRetentionClass(request: {
    readonly entityId: string
    readonly documentIds: readonly string[]
    readonly retentionClass: RetentionClass
  }): Promise<number> {
    if (request.documentIds.length === 0) return 0

    const updated = await this.tx
      .update(documents)
      .set({ retentionClass: request.retentionClass })
      .where(
        and(
          eq(documents.entityId, request.entityId),
          inArray(documents.id, [...request.documentIds]),
        ),
      )
      .returning({ id: documents.id })

    // The term follows the class, so re-derive rather than leave a ten-year
    // document carrying a seven-year date.
    await this.dateDocuments(request.entityId)
    return updated.length
  }

  /**
   * Mark the bytes gone.
   *
   * The row stays, with its hash and its size. An inspector asking what used to
   * be here gets an answer; a document that turns up later can be checked
   * against what it claims to be; and the deletion itself stays auditable,
   * which erasing the row would make impossible.
   *
   * The bytes themselves are removed by the caller, from the store, *after*
   * this commits — see `documents.ts` in the handlers for why that order.
   */
  async markDeleted(request: {
    readonly entityId: string
    readonly documentIds: readonly string[]
    readonly actorId: string
    readonly reason: string
  }): Promise<readonly { readonly id: string; readonly sha256: string }[]> {
    if (request.documentIds.length === 0) return []

    return this.tx
      .update(documents)
      .set({
        deletedAt: new Date(),
        deletedBy: request.actorId,
        deletedReason: request.reason,
      })
      .where(
        and(
          eq(documents.entityId, request.entityId),
          inArray(documents.id, [...request.documentIds]),
          isNull(documents.deletedAt),
        ),
      )
      .returning({ id: documents.id, sha256: documents.sha256 })
  }

  /**
   * Whether these bytes are still needed by anybody.
   *
   * Documents are content-addressed and shared across entities, so deleting a
   * row must not delete bytes another administration is keeping. This is the
   * check that stands between "our copy is past its term" and "the file is
   * gone for everyone".
   */
  async hashesStillHeld(hashes: readonly string[]): Promise<Set<string>> {
    if (hashes.length === 0) return new Set()

    const rows = await this.tx
      .select({ sha256: documents.sha256 })
      .from(documents)
      .where(and(inArray(documents.sha256, [...hashes]), isNull(documents.deletedAt)))

    return new Set(rows.map((row) => row.sha256))
  }
}
