import { boolean, index, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { klopt } from './schema.js'
import { entities, outbox } from './ledger.js'

/**
 * Webhook delivery (spec 10.2). See migration 0028 for why an endpoint holds a
 * cursor rather than the outbox holding a row per subscriber.
 */
export const webhookEndpoints = klopt.table(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    url: text('url').notNull(),
    /** Encrypted at rest. Shown once, at creation. */
    secret: text('secret').notNull(),
    /** Empty means every type, including ones added later. */
    eventTypes: text('event_types').array().notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    /** The last event delivered. Null means "from the beginning". */
    cursor: uuid('cursor'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    nextAttemptAfter: timestamp('next_attempt_after', { withTimezone: true, mode: 'string' }),
    disabledReason: text('disabled_reason'),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true, mode: 'string' }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('webhook_endpoints_due').on(table.enabled, table.nextAttemptAfter)],
)

/** What was attempted. Evidence, not control flow — the cursor is that. */
export const webhookDeliveries = klopt.table(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => outbox.id),
    attempt: integer('attempt').notNull(),
    /** Null when the request never got a reply at all. */
    responseStatus: integer('response_status'),
    error: text('error'),
    durationMs: integer('duration_ms').notNull(),
    at: timestamp('at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (table) => [index('webhook_deliveries_endpoint').on(table.endpointId, table.at)],
)
