import { uuidv7 } from '@klopt/core'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { documentLinks, documents, inboxItems } from '../schema/documents.js'
import { contacts } from '../schema/sales.js'
import { purchaseInvoices } from '../schema/purchase.js'

/**
 * The purchase inbox, and the documents behind it.
 *
 * Two things here are worth reading twice.
 *
 * `recordDocument` is an upsert on the hash, because the same bytes arriving
 * twice are one document. The second arrival gets the first document's id, so
 * the two inbox items point at the same row and the screen can say "you already
 * have this one" — which is the whole reason content addressing is worth having
 * over a uuid and a filename.
 *
 * `matchSupplier` tries identifiers in the order that makes them trustworthy: a
 * VAT number identifies a company, a KvK number identifies a registration, an
 * IBAN identifies an account somebody controls, and a name identifies nothing
 * at all. So the name is not tried. An unmatched document is a document
 * somebody looks at, which is a better outcome than one silently filed under
 * the wrong supplier.
 */

export interface InboxItemRow {
  readonly id: string
  readonly state: 'new' | 'drafted' | 'discarded'
  readonly source: 'upload' | 'email' | 'peppol' | 'generated'
  readonly receivedFrom: string | null
  readonly subject: string | null
  readonly filename: string | null
  readonly contentType: string
  readonly sizeBytes: number
  readonly sha256: string
  readonly documentId: string
  readonly parsed: unknown
  readonly parseError: string | null
  readonly contactId: string | null
  readonly contactNumber: string | null
  readonly contactName: string | null
  readonly purchaseInvoiceId: string | null
  readonly discardedReason: string | null
  readonly externalId: string | null
  readonly receivedAt: string
  /** True when these exact bytes were already in the inbox before. */
  readonly duplicateOfCount: number
}

export class InboxRepository {
  constructor(private readonly tx: Transaction) {}

  /**
   * Record that this entity holds these bytes.
   *
   * Returns the existing row when the hash is already known, so the same
   * document arriving twice is one row and two arrivals.
   */
  async recordDocument(request: {
    readonly entityId: string
    readonly sha256: string
    readonly sizeBytes: number
    readonly contentType: string
    readonly filename: string | null
  }): Promise<{ readonly id: string; readonly existed: boolean }> {
    const [existing] = await this.tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.entityId, request.entityId), eq(documents.sha256, request.sha256)))
      .limit(1)

    if (existing !== undefined) return { id: existing.id, existed: true }

    const id = uuidv7()
    await this.tx.insert(documents).values({
      id,
      entityId: request.entityId,
      sha256: request.sha256,
      sizeBytes: request.sizeBytes,
      contentType: request.contentType,
      filename: request.filename,
    })
    return { id, existed: false }
  }

  /**
   * Record an arrival.
   *
   * Returns the existing row when this arrival has been taken before, which is
   * what makes polling safe to repeat. A source is acknowledged only *after*
   * the documents are committed — at-least-once is the correct failure
   * direction, because the alternative loses invoices — so the same message
   * coming round twice is expected rather than exceptional.
   */
  async addItem(request: {
    readonly entityId: string
    readonly documentId: string
    readonly source: 'upload' | 'email' | 'peppol' | 'generated'
    readonly receivedFrom: string | null
    readonly subject: string | null
    readonly parsed: unknown
    readonly parseError: string | null
    readonly contactId: string | null
    readonly externalId?: string | null
    readonly externalPart?: string | null
    readonly discardedReason?: string | null
  }): Promise<{ readonly id: string; readonly existed: boolean }> {
    const externalId = request.externalId ?? null
    const externalPart = request.externalPart ?? null

    if (externalId !== null) {
      const [existing] = await this.tx
        .select({ id: inboxItems.id })
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.entityId, request.entityId),
            eq(inboxItems.source, request.source),
            eq(inboxItems.externalId, externalId),
            externalPart === null
              ? isNull(inboxItems.externalPart)
              : eq(inboxItems.externalPart, externalPart),
          ),
        )
        .limit(1)

      if (existing !== undefined) return { id: existing.id, existed: true }
    }

    const discardedReason = request.discardedReason ?? null
    const id = uuidv7()
    await this.tx.insert(inboxItems).values({
      id,
      entityId: request.entityId,
      documentId: request.documentId,
      source: request.source,
      state: discardedReason === null ? 'new' : 'discarded',
      receivedFrom: request.receivedFrom,
      subject: request.subject,
      parsed: request.parsed,
      parseError: request.parseError,
      contactId: request.contactId,
      externalId,
      externalPart,
      discardedReason,
    })
    return { id, existed: false }
  }

  async list(entityId: string, state?: 'new' | 'drafted' | 'discarded'): Promise<InboxItemRow[]> {
    const rows = await this.tx
      .select({
        id: inboxItems.id,
        state: inboxItems.state,
        source: inboxItems.source,
        receivedFrom: inboxItems.receivedFrom,
        subject: inboxItems.subject,
        parsed: inboxItems.parsed,
        parseError: inboxItems.parseError,
        contactId: inboxItems.contactId,
        purchaseInvoiceId: inboxItems.purchaseInvoiceId,
        discardedReason: inboxItems.discardedReason,
        externalId: inboxItems.externalId,
        receivedAt: inboxItems.receivedAt,
        documentId: documents.id,
        sha256: documents.sha256,
        sizeBytes: documents.sizeBytes,
        contentType: documents.contentType,
        filename: documents.filename,
        contactNumber: contacts.number,
        contactName: contacts.name,
      })
      .from(inboxItems)
      .innerJoin(documents, eq(documents.id, inboxItems.documentId))
      .leftJoin(contacts, eq(contacts.id, inboxItems.contactId))
      .where(
        and(
          eq(inboxItems.entityId, entityId),
          state === undefined ? undefined : eq(inboxItems.state, state),
        ),
      )
      .orderBy(desc(inboxItems.receivedAt), desc(inboxItems.id))

    // How many other items share each document. Anything above one means these
    // exact bytes have been here before, which is worth showing rather than
    // leaving somebody to notice.
    const counts = new Map<string, number>()
    if (rows.length > 0) {
      const siblings = await this.tx
        .select({ documentId: inboxItems.documentId, id: inboxItems.id })
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.entityId, entityId),
            inArray(
              inboxItems.documentId,
              rows.map((row) => row.documentId),
            ),
          ),
        )
      for (const sibling of siblings) {
        counts.set(sibling.documentId, (counts.get(sibling.documentId) ?? 0) + 1)
      }
    }

    return rows.map((row) => ({
      ...row,
      receivedAt: row.receivedAt.toISOString(),
      duplicateOfCount: (counts.get(row.documentId) ?? 1) - 1,
    }))
  }

  async get(entityId: string, itemId: string): Promise<InboxItemRow | null> {
    const rows = await this.list(entityId)
    return rows.find((row) => row.id === itemId) ?? null
  }

  /**
   * Find the supplier a document came from.
   *
   * By identifier only. A VAT number identifies a company, a KvK number a
   * registration, an IBAN an account somebody controls — a name identifies
   * nothing, and "Jansen B.V." matching the wrong Jansen is worse than no
   * match at all, because nobody looks at a match that already happened.
   */
  async matchSupplier(
    entityId: string,
    identifiers: {
      readonly vatNumber: string | null
      readonly kvkNumber: string | null
      readonly iban: string | null
    },
  ): Promise<{ readonly id: string; readonly number: string; readonly name: string } | null> {
    const candidates = await this.tx
      .select({
        id: contacts.id,
        number: contacts.number,
        name: contacts.name,
        vatNumber: contacts.vatNumber,
        kvkNumber: contacts.kvkNumber,
        iban: contacts.iban,
      })
      .from(contacts)
      .where(and(eq(contacts.entityId, entityId), eq(contacts.isSupplier, true)))
      .orderBy(asc(contacts.number))

    const normalise = (value: string | null): string | null =>
      value === null ? null : value.toUpperCase().replace(/[\s.-]/g, '')

    const wantedVat = normalise(identifiers.vatNumber)
    const wantedKvk = normalise(identifiers.kvkNumber)
    const wantedIban = normalise(identifiers.iban)

    // In order of how much each identifier proves.
    for (const [wanted, field] of [
      [wantedVat, 'vatNumber'],
      [wantedKvk, 'kvkNumber'],
      [wantedIban, 'iban'],
    ] as const) {
      if (wanted === null) continue
      const matches = candidates.filter((candidate) => normalise(candidate[field]) === wanted)
      // Exactly one, or it is not a match: two suppliers sharing an IBAN is a
      // question, not an answer.
      if (matches.length === 1) {
        const found = matches[0]!
        return { id: found.id, number: found.number, name: found.name }
      }
    }

    return null
  }

  async markDrafted(request: {
    readonly entityId: string
    readonly itemId: string
    readonly purchaseInvoiceId: string
    readonly contactId: string
    readonly actorId: string
  }): Promise<void> {
    await this.tx
      .update(inboxItems)
      .set({
        state: 'drafted',
        purchaseInvoiceId: request.purchaseInvoiceId,
        contactId: request.contactId,
        handledBy: request.actorId,
        handledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(inboxItems.entityId, request.entityId), eq(inboxItems.id, request.itemId)))
  }

  async discard(request: {
    readonly entityId: string
    readonly itemId: string
    readonly reason: string
    readonly actorId: string
  }): Promise<void> {
    await this.tx
      .update(inboxItems)
      .set({
        state: 'discarded',
        discardedReason: request.reason,
        handledBy: request.actorId,
        handledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(inboxItems.entityId, request.entityId), eq(inboxItems.id, request.itemId)))
  }

  /** Attach a document to whatever it is evidence for. */
  async link(request: {
    readonly entityId: string
    readonly documentId: string
    readonly subjectKind: string
    readonly subjectId: string
    readonly role: string | null
  }): Promise<void> {
    await this.tx
      .insert(documentLinks)
      .values({
        id: uuidv7(),
        entityId: request.entityId,
        documentId: request.documentId,
        subjectKind: request.subjectKind,
        subjectId: request.subjectId,
        role: request.role,
      })
      .onConflictDoNothing()
  }

  /** Everything attached to a subject, for its detail screen. */
  async documentsFor(
    entityId: string,
    subjectKind: string,
    subjectId: string,
  ): Promise<
    readonly {
      readonly id: string
      readonly sha256: string
      readonly filename: string | null
      readonly contentType: string
      readonly sizeBytes: number
      readonly role: string | null
    }[]
  > {
    return this.tx
      .select({
        id: documents.id,
        sha256: documents.sha256,
        filename: documents.filename,
        contentType: documents.contentType,
        sizeBytes: documents.sizeBytes,
        role: documentLinks.role,
      })
      .from(documentLinks)
      .innerJoin(documents, eq(documents.id, documentLinks.documentId))
      .where(
        and(
          eq(documentLinks.entityId, entityId),
          eq(documentLinks.subjectKind, subjectKind),
          eq(documentLinks.subjectId, subjectId),
        ),
      )
      .orderBy(asc(documentLinks.createdAt))
  }

  /** A document by id, for download. */
  async document(
    entityId: string,
    documentId: string,
  ): Promise<{
    readonly sha256: string
    readonly filename: string | null
    readonly contentType: string
    /** Set when the bytes were deliberately removed after their term. */
    readonly deletedAt: Date | null
    readonly deletedReason: string | null
  } | null> {
    const [row] = await this.tx
      .select({
        sha256: documents.sha256,
        filename: documents.filename,
        contentType: documents.contentType,
        deletedAt: documents.deletedAt,
        deletedReason: documents.deletedReason,
      })
      .from(documents)
      .where(and(eq(documents.entityId, entityId), eq(documents.id, documentId)))
      .limit(1)

    return row ?? null
  }

  /** Whether this supplier already sent an invoice with this number. */
  async invoiceExists(
    entityId: string,
    contactId: string,
    supplierInvoiceNumber: string,
  ): Promise<boolean> {
    const rows = await this.tx
      .select({ id: purchaseInvoices.id })
      .from(purchaseInvoices)
      .where(
        and(
          eq(purchaseInvoices.entityId, entityId),
          eq(purchaseInvoices.contactId, contactId),
          eq(purchaseInvoices.supplierInvoiceNumber, supplierInvoiceNumber),
        ),
      )
      .limit(1)

    return rows.length > 0
  }
}
