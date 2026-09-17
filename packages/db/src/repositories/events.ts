import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { outbox } from '../schema/ledger.js'

/**
 * Reading the event stream (spec 10.2).
 *
 * > Webhooks from the transactional outbox … plus a pollable `/events` cursor
 * > endpoint, because self-hosters behind NAT cannot receive webhooks.
 *
 * This is that endpoint's repository. It is the *same* rows the webhook
 * delivery will read — one outbox, two ways of getting at it — so an
 * integrator who polls and an integrator who subscribes see the same stream in
 * the same order, and can switch between them without gaps.
 *
 * ## The cursor is the id, and the id is sortable
 *
 * `outbox.id` is a uuidv7: monotonic by construction, unique, and already the
 * dedup id a consumer needs. Using it as the cursor means "everything after
 * what I last saw" is one index scan and one comparison, with no ties to break
 * and no clock to trust. A timestamp cursor would need a tiebreaker and would
 * still be wrong across a leap second or a clock adjustment.
 *
 * Ascending, always. An event stream read newest-first cannot be resumed.
 */

export interface EventRow {
  readonly id: string
  readonly occurredAt: string
  readonly type: string
  readonly version: number
  readonly entityId: string
  readonly payload: unknown
}

export interface EventQuery {
  readonly entityId: string
  /** The id of the last event already handled. Exclusive. */
  readonly after?: string | undefined
  /** Only these types. Absent means all of them. */
  readonly types?: readonly string[] | undefined
  readonly limit?: number | undefined
}

export class EventRepository {
  constructor(private readonly tx: Transaction) {}

  async list(query: EventQuery): Promise<EventRow[]> {
    const conditions = [eq(outbox.entityId, query.entityId)]

    // Exclusive, so handing back the last id you saw is the whole protocol.
    if (query.after !== undefined) conditions.push(gt(outbox.id, query.after))
    if (query.types !== undefined && query.types.length > 0) {
      conditions.push(inArray(outbox.type, [...query.types]))
    }

    return this.tx
      .select({
        id: outbox.id,
        occurredAt: outbox.occurredAt,
        type: outbox.type,
        version: outbox.version,
        entityId: outbox.entityId,
        payload: outbox.payload,
      })
      .from(outbox)
      .where(and(...conditions))
      .orderBy(asc(outbox.id))
      .limit(Math.min(query.limit ?? 100, 1000))
  }
}
