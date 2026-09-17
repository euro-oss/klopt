import { char, index, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { klopt } from './schema.js'
import { entities } from './ledger.js'

export const vatNumberOutcome = klopt.enum('vat_number_outcome', [
  'valid',
  'invalid',
  'unavailable',
])

/**
 * Every VIES answer, kept.
 *
 * Append-only, enforced by a trigger. A number that was valid last quarter and
 * is invalid now is two facts, and the older one is what defends last quarter's
 * zero rate — so the newest row is the current answer and none of them are ever
 * replaced.
 */
export const vatNumberChecks = klopt.table(
  'vat_number_checks',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    /** Normalised: uppercase, no spaces or punctuation. What VIES was asked. */
    vatNumber: text('vat_number').notNull(),
    countryCode: char('country_code', { length: 2 }).notNull(),
    outcome: vatNumberOutcome('outcome').notNull(),
    name: text('name'),
    address: text('address'),
    requestDate: text('request_date'),
    /** The consultation number: the proof. Null when asked anonymously. */
    requestIdentifier: text('request_identifier'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
    source: text('source').notNull(),
    /** The response verbatim, so the evidence survives our parser. */
    raw: text('raw').notNull(),
    error: text('error'),
    requestedBy: text('requested_by'),
    /** One key per request, shared by the batch. A retry replays these rows. */
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('vat_number_checks_lookup').on(table.entityId, table.vatNumber),
    index('vat_number_checks_idempotency').on(table.entityId, table.idempotencyKey),
  ],
)
