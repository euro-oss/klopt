import { index, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { klopt } from './schema.js'
import { entities } from './ledger.js'
import { vatFilings } from './vat.js'

export const filingTransport = klopt.enum('filing_transport', [
  'manual',
  'sbr_provider',
  'digipoort',
])
export const filingStatus = klopt.enum('filing_status', [
  'prepared',
  'delivered',
  'accepted',
  'rejected',
  'failed',
])
export const filingInteraction = klopt.enum('filing_interaction', [
  'deliver',
  'status',
  'confirmation',
])

/**
 * Every interaction with whoever carries a filing.
 *
 * Spec 7.2 asks for "all status responses", plural, and that is the shape: a
 * Digipoort filing is delivered once and then polled until the Belastingdienst
 * has processed it, so a submission is a history rather than a state. One row
 * per interaction, append-only, enforced by the same trigger the journal uses —
 * evidence that can be edited is not evidence.
 *
 * The instance is stored on the row that sent it, not once per filing: a
 * suppletie sends different bytes and a retry after a rejection sends corrected
 * ones, and which bytes went out when is the question this table answers.
 */
export const filingSubmissions = klopt.table(
  'filing_submissions',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    filingId: uuid('filing_id')
      .notNull()
      .references(() => vatFilings.id),
    interaction: filingInteraction('interaction').notNull(),
    transport: filingTransport('transport').notNull(),
    status: filingStatus('status').notNull(),
    /** Digipoort's kenmerk, a provider's job id, or the operator's receipt. */
    reference: text('reference'),
    taxonomyVersion: text('taxonomy_version'),
    /** The bytes that were filed. Null on a poll, which sends no instance. */
    instanceXml: text('instance_xml'),
    summary: text('summary'),
    /** Verbatim and unparsed: when a service rewords itself, evidence stays. */
    requestBody: text('request_body'),
    responseBody: text('response_body'),
    error: text('error'),
    instructions: text('instructions'),
    actorId: text('actor_id'),
    at: timestamp('at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('filing_submissions_filing').on(table.filingId, table.at)],
)
