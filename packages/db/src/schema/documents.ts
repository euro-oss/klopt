import { sql } from 'drizzle-orm'
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { klopt } from './schema.js'
import { entities } from './ledger.js'
import { contacts } from './sales.js'
import { purchaseInvoices } from './purchase.js'

export const documentSource = klopt.enum('document_source', [
  'upload',
  'email',
  'peppol',
  'generated',
])

export const inboxState = klopt.enum('inbox_state', ['new', 'drafted', 'discarded'])

export const inboundSourceKind = klopt.enum('inbound_source_kind', ['maildir', 'imap', 'peppol'])

/**
 * A source document, addressed by the hash of its bytes (spec 7.6).
 *
 * Content-addressed and deduplicated: the same invoice arriving by email and
 * again over Peppol is one row, and the two arrivals are two inbox items
 * pointing at it. That is not a space optimisation — it is how the inbox knows
 * the second arrival is the same document.
 *
 * Append-only, enforced by the same trigger the journal uses. The bewaarplicht
 * runs seven years and its test is that the administration stays accessible,
 * readable and controllable; bytes that can quietly change are none of those.
 * The bytes live in a `DocumentStore`; this is the index and the record of when
 * each one first appeared.
 */
export const documents = klopt.table(
  'documents',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    /** The address and the identity. Lowercase hex. */
    sha256: char('sha256', { length: 64 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    contentType: text('content_type').notNull(),
    /** Metadata on the arrival, not on the bytes. */
    filename: text('filename'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('documents_entity_hash').on(table.entityId, table.sha256),
    check('documents_hash_shape', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
)

/**
 * What a document is evidence for.
 *
 * A `(kind, id)` pair rather than seven nullable foreign keys, because a
 * purchase invoice's UBL, a sales invoice's PDF and a bank statement's original
 * file are the same relationship wearing different hats — and adding the eighth
 * kind should not be a migration.
 */
export const documentLinks = klopt.table(
  'document_links',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    subjectKind: text('subject_kind').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /** `original`, `rendering`, `attachment`. */
    role: text('role'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('document_links_unique').on(table.documentId, table.subjectKind, table.subjectId),
    index('document_links_subject').on(table.entityId, table.subjectKind, table.subjectId),
  ],
)

/**
 * The purchase inbox.
 *
 * Spec 6: "A purchase-invoice inbox that ingests email, PDF, and Peppol UBL
 * into the same queue." One queue and one shape whatever the source, because
 * the work in front of a bookkeeper is the same work regardless of how the
 * document got there.
 *
 * `parsed` holds what could be read out of the document — a UBL invoice reads
 * into a whole draft, a PDF reads into nothing — and `parse_error` holds why
 * when it could not. Both are kept rather than recomputed: a reader that
 * changes should not silently change what an operator was shown last week.
 */
export const inboxItems = klopt.table(
  'inbox_items',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    source: documentSource('source').notNull(),
    state: inboxState('state').notNull().default('new'),
    /**
     * What the transport called this arrival, and which part of it this is.
     *
     * The bytes are deduplicated by their hash, but two arrivals of the same
     * document are two arrivals. "Have I already taken this message" is only
     * answerable by the transport's own name for it — without which a poll that
     * failed to acknowledge would file the same invoice again.
     */
    externalId: text('external_id'),
    externalPart: text('external_part'),
    /** An email address, a Peppol participant id, or whoever uploaded it. */
    receivedFrom: text('received_from'),
    subject: text('subject'),
    parsed: jsonb('parsed'),
    parseError: text('parse_error'),
    contactId: uuid('contact_id').references(() => contacts.id),
    purchaseInvoiceId: uuid('purchase_invoice_id').references(() => purchaseInvoices.id),
    discardedReason: text('discarded_reason'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    handledBy: text('handled_by'),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('inbox_items_state').on(table.entityId, table.state, table.receivedAt),
    uniqueIndex('inbox_items_external')
      .on(table.entityId, table.source, table.externalId, table.externalPart)
      .where(sql`${table.externalId} is not null`),
    index('inbox_items_document').on(table.entityId, table.documentId),
    check(
      'inbox_items_drafted_has_invoice',
      sql`(${table.state} = 'drafted') = (${table.purchaseInvoiceId} is not null)`,
    ),
    check(
      'inbox_items_discarded_has_reason',
      sql`(${table.state} <> 'discarded') or (${table.discardedReason} is not null)`,
    ),
  ],
)

/**
 * A mailbox or an access point an administration receives documents on.
 *
 * Per entity rather than per instance, because `facturen@ditbedrijf.nl` belongs
 * to an administration in a way a signing certificate nearly does not (spec 8,
 * rule 2). The secret is a column of its own so that showing somebody their
 * settings never has to load it.
 */
export const inboundSources = klopt.table(
  'inbound_sources',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    kind: inboundSourceKind('kind').notNull(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Host, port, mailbox, directory. Nothing secret. */
    config: jsonb('config').notNull().default({}),
    /** Encrypted at rest. Null for a drop directory, which authenticates to nothing. */
    secret: text('secret'),
    /** Where the last poll got to. Opaque to everything but its own adapter. */
    cursor: text('cursor'),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastMessageCount: integer('last_message_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('inbound_sources_entity_name').on(table.entityId, table.name),
    index('inbound_sources_due').on(table.enabled, table.lastPolledAt),
  ],
)
