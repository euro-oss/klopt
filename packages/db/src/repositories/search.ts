import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { SearchResourceType } from '@klopt/core'
import type { Transaction } from '../client.js'
import {
  contacts,
  documents,
  inboxItems,
  journalEntries,
  journalLines,
  journals,
  purchaseInvoices,
  salesInvoices,
} from '../schema/index.js'

/**
 * One search across the things somebody names out loud (spec 10.3).
 *
 * "One entry point across invoices, contacts, entries and documents." It is
 * deliberately not a query language: five named resources, a substring over a
 * fixed list of columns per resource, and nothing a caller can widen. The MCP
 * server's whole safety model rests on there being no generic query tool, and
 * a `search` that took a filter expression would be one.
 */

export interface SearchQuery {
  readonly entityId: string
  readonly term: string
  readonly types: readonly SearchResourceType[]
  /** Per type, not in total. A type that fills it reports itself truncated. */
  readonly limit: number
}

export interface SearchHit {
  readonly type: SearchResourceType
  readonly id: string
  /** What the resource is called: a number, a name, a subject. */
  readonly title: string
  /** The second line: who it is with, or what it was for. */
  readonly subtitle: string | null
  /** The date a human would sort by. Null where the resource has none. */
  readonly date: string | null
  readonly amountMinorUnits: bigint | null
  readonly currency: string | null
  /** Where to read the whole thing. Relative to /api/v1 (spec 10.3). */
  readonly path: string
  /**
   * 0 an exact identifier, 1 a prefix, 2 somewhere inside.
   *
   * Typing an invoice number has one right answer and it should not be third
   * behind two contacts whose notes happen to contain it.
   */
  readonly rank: number
}

export interface SearchResult {
  readonly hits: readonly SearchHit[]
  /** The types that filled `limit`, so a caller knows the list is partial. */
  readonly truncated: readonly SearchResourceType[]
}

/**
 * `%` and `_` are wildcards, and a bookkeeper searching for `50%` means 50%.
 *
 * Postgres's default escape character for LIKE is the backslash, and the
 * pattern arrives as a bind parameter, so escaping here is the whole of it.
 */
function contains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

function prefix(term: string): string {
  return `${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

export class SearchRepository {
  constructor(private readonly tx: Transaction) {}

  async search(query: SearchQuery): Promise<SearchResult> {
    const wanted = new Set(query.types)
    const hits: SearchHit[] = []
    const truncated: SearchResourceType[] = []

    const collect = async (
      type: SearchResourceType,
      run: () => Promise<readonly SearchHit[]>,
    ): Promise<void> => {
      if (!wanted.has(type)) return
      const found = await run()
      hits.push(...found)
      if (found.length >= query.limit) truncated.push(type)
    }

    await collect('contact', () => this.contacts(query))
    await collect('sales-invoice', () => this.salesInvoices(query))
    await collect('purchase-invoice', () => this.purchaseInvoices(query))
    await collect('journal-entry', () => this.journalEntries(query))
    await collect('document', () => this.documents(query))

    // Merged rather than grouped by type: somebody who types an invoice number
    // wants that invoice, whichever of the five it turned out to live in.
    hits.sort(
      (a, b) =>
        a.rank - b.rank ||
        (b.date ?? '').localeCompare(a.date ?? '') ||
        a.type.localeCompare(b.type) ||
        a.title.localeCompare(b.title),
    )

    return { hits, truncated }
  }

  /** 0 for an identifier that is exactly the term, 1 for a prefix, else 2. */
  private rankOf(exact: SQL | undefined, starts: SQL | undefined): SQL<number> {
    return sql<number>`case when ${exact} then 0 when ${starts} then 1 else 2 end`
  }

  private async contacts(query: SearchQuery): Promise<readonly SearchHit[]> {
    const like = contains(query.term)
    const rank = this.rankOf(
      sql`lower(${contacts.number}) = lower(${query.term}) or lower(${contacts.name}) = lower(${query.term})`,
      sql`${contacts.number} ilike ${prefix(query.term)} or ${contacts.name} ilike ${prefix(query.term)}`,
    )

    const rows = await this.tx
      .select({
        id: contacts.id,
        number: contacts.number,
        name: contacts.name,
        email: contacts.email,
        rank,
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.entityId, query.entityId),
          or(
            ilike(contacts.number, like),
            ilike(contacts.name, like),
            ilike(contacts.legalName, like),
            ilike(contacts.email, like),
            ilike(contacts.vatNumber, like),
            ilike(contacts.kvkNumber, like),
            ilike(contacts.iban, like),
          ),
        ),
      )
      .orderBy(asc(rank), asc(contacts.name))
      .limit(query.limit)

    return rows.map((row) => ({
      type: 'contact' as const,
      id: row.id,
      title: `${row.number} ${row.name}`,
      subtitle: row.email,
      date: null,
      amountMinorUnits: null,
      currency: null,
      path: `/contacts/${row.id}`,
      rank: Number(row.rank),
    }))
  }

  private async salesInvoices(query: SearchQuery): Promise<readonly SearchHit[]> {
    const like = contains(query.term)
    const rank = this.rankOf(
      sql`lower(coalesce(${salesInvoices.number}, '')) = lower(${query.term})`,
      sql`coalesce(${salesInvoices.number}, '') ilike ${prefix(query.term)}`,
    )

    const rows = await this.tx
      .select({
        id: salesInvoices.id,
        number: salesInvoices.number,
        status: salesInvoices.status,
        issueDate: salesInvoices.issueDate,
        total: salesInvoices.totalMinorUnits,
        currency: salesInvoices.currency,
        reference: salesInvoices.reference,
        // The snapshot where there is one, the contact where there is not: a
        // draft has no buyer snapshot yet, and it is still somebody's invoice.
        buyerName: sql<string>`coalesce(${salesInvoices.buyerName}, ${contacts.name})`,
        rank,
      })
      .from(salesInvoices)
      .innerJoin(contacts, eq(contacts.id, salesInvoices.contactId))
      .where(
        and(
          eq(salesInvoices.entityId, query.entityId),
          or(
            ilike(salesInvoices.number, like),
            ilike(salesInvoices.reference, like),
            ilike(salesInvoices.buyerReference, like),
            ilike(salesInvoices.buyerName, like),
            ilike(salesInvoices.notes, like),
            ilike(contacts.name, like),
          ),
        ),
      )
      .orderBy(asc(rank), desc(salesInvoices.issueDate))
      .limit(query.limit)

    return rows.map((row) => ({
      type: 'sales-invoice' as const,
      id: row.id,
      title: row.number ?? `Concept ${row.id.slice(0, 8)}`,
      subtitle: row.buyerName,
      date: row.issueDate,
      amountMinorUnits: row.total,
      currency: row.currency,
      path: `/sales-invoices/${row.id}`,
      rank: Number(row.rank),
    }))
  }

  private async purchaseInvoices(query: SearchQuery): Promise<readonly SearchHit[]> {
    const like = contains(query.term)
    const rank = this.rankOf(
      sql`lower(${purchaseInvoices.supplierInvoiceNumber}) = lower(${query.term})`,
      sql`${purchaseInvoices.supplierInvoiceNumber} ilike ${prefix(query.term)}`,
    )

    const rows = await this.tx
      .select({
        id: purchaseInvoices.id,
        number: purchaseInvoices.supplierInvoiceNumber,
        invoiceDate: purchaseInvoices.invoiceDate,
        total: purchaseInvoices.totalMinorUnits,
        currency: purchaseInvoices.currency,
        supplierName: contacts.name,
        rank,
      })
      .from(purchaseInvoices)
      .innerJoin(contacts, eq(contacts.id, purchaseInvoices.contactId))
      .where(
        and(
          eq(purchaseInvoices.entityId, query.entityId),
          or(
            ilike(purchaseInvoices.supplierInvoiceNumber, like),
            ilike(purchaseInvoices.paymentReference, like),
            ilike(purchaseInvoices.notes, like),
            ilike(contacts.name, like),
          ),
        ),
      )
      .orderBy(asc(rank), desc(purchaseInvoices.invoiceDate))
      .limit(query.limit)

    return rows.map((row) => ({
      type: 'purchase-invoice' as const,
      id: row.id,
      title: row.number,
      subtitle: row.supplierName,
      date: row.invoiceDate,
      amountMinorUnits: row.total,
      currency: row.currency,
      path: `/purchase-invoices/${row.id}`,
      rank: Number(row.rank),
    }))
  }

  private async journalEntries(query: SearchQuery): Promise<readonly SearchHit[]> {
    const like = contains(query.term)
    const number = sql<string>`${journals.code} || ' ' || ${journalEntries.entryNumber}`
    const rank = this.rankOf(
      sql`lower(${number}) = lower(${query.term}) or ${journalEntries.entryNumber}::text = ${query.term}`,
      sql`${number} ilike ${prefix(query.term)}`,
    )

    const rows = await this.tx
      .select({
        id: journalEntries.id,
        number,
        bookingDate: journalEntries.bookingDate,
        description: journalEntries.description,
        currency: journalEntries.functionalCurrency,
        // What the entry is worth: its debit side, which by construction is
        // its credit side. A result with no amount is a result an agent has to
        // make a second call to understand.
        total: sql<string>`(
          select coalesce(sum(${journalLines.functionalDebitMinorUnits}), 0)
          from ${journalLines}
          where ${journalLines.entryId} = ${journalEntries.id}
        )`,
        rank,
      })
      .from(journalEntries)
      .innerJoin(journals, eq(journals.id, journalEntries.journalId))
      .where(
        and(
          eq(journalEntries.entityId, query.entityId),
          or(
            ilike(journalEntries.description, like),
            ilike(journalEntries.sourceDocumentRef, like),
            sql`${journalEntries.entryNumber}::text ilike ${like}`,
            sql`${number} ilike ${like}`,
          ),
        ),
      )
      .orderBy(asc(rank), desc(journalEntries.bookingDate))
      .limit(query.limit)

    return rows.map((row) => ({
      type: 'journal-entry' as const,
      id: row.id,
      title: row.number,
      subtitle: row.description,
      date: row.bookingDate,
      amountMinorUnits: BigInt(row.total),
      currency: row.currency,
      path: `/journal-entries/${row.id}`,
      rank: Number(row.rank),
    }))
  }

  /**
   * A document is found by what the transport called it and by what arrived
   * with it, which are on two tables.
   *
   * An `exists` rather than a join, because one document can have arrived
   * twice — the same PDF emailed and then uploaded — and a join would return
   * it twice under one id.
   */
  private async documents(query: SearchQuery): Promise<readonly SearchHit[]> {
    const like = contains(query.term)
    const arrival = (column: PgColumn) => sql`(
      select ${column} from ${inboxItems}
      where ${inboxItems.documentId} = ${documents.id}
      order by ${inboxItems.receivedAt} desc
      limit 1
    )`

    const rank = this.rankOf(
      sql`lower(coalesce(${documents.filename}, '')) = lower(${query.term})`,
      sql`coalesce(${documents.filename}, '') ilike ${prefix(query.term)}`,
    )

    const rows = await this.tx
      .select({
        id: documents.id,
        filename: documents.filename,
        firstSeenAt: documents.firstSeenAt,
        subject: sql<string | null>`${arrival(inboxItems.subject)}`,
        receivedFrom: sql<string | null>`${arrival(inboxItems.receivedFrom)}`,
        rank,
      })
      .from(documents)
      .where(
        and(
          eq(documents.entityId, query.entityId),
          // A deleted document keeps its row for the audit trail. It is not a
          // search result: there is nothing left to open.
          sql`${documents.deletedAt} is null`,
          or(
            ilike(documents.filename, like),
            sql`exists (
              select 1 from ${inboxItems}
              where ${inboxItems.documentId} = ${documents.id}
                and (${inboxItems.subject} ilike ${like} or ${inboxItems.receivedFrom} ilike ${like})
            )`,
          ),
        ),
      )
      .orderBy(asc(rank), desc(documents.firstSeenAt))
      .limit(query.limit)

    return rows.map((row) => ({
      type: 'document' as const,
      id: row.id,
      title: row.filename ?? row.subject ?? 'Document',
      subtitle: row.receivedFrom ?? row.subject,
      date: row.firstSeenAt.toISOString().slice(0, 10),
      amountMinorUnits: null,
      currency: null,
      path: `/documents/${row.id}`,
      rank: Number(row.rank),
    }))
  }
}
