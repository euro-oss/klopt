import { uuidv7, type AuditEvent } from '@klopt/core'
import { and, asc, desc, eq, gte, lt, lte, sql, type SQL } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { auditLog } from '../schema/ledger.js'

/**
 * The audit log (spec 7.6): "every state change: actor, timestamp, entity,
 * before and after, request id, IP. Append-only, exportable, and covering API
 * calls as well as UI actions."
 *
 * ## What is here that was not
 *
 * The table and its append-only trigger have existed since M0, and three places
 * wrote to it: posting a journal entry, changing a membership, and importing
 * RGS. Everything else — issuing an invoice, approving a payment, filing an
 * aangifte, changing the VAT rounding — left no trace at all. An audit log with
 * a hole in it is worse than none, because the hole is invisible: the reader
 * concludes nothing happened.
 *
 * ## Append-only means append-only
 *
 * There is no update and no delete here, and the database refuses both anyway
 * (`0001_ledger_guards.sql`). A correction is another row, exactly as a wrong
 * journal entry is another entry.
 *
 * ## Who, not just what
 *
 * `actor_kind` separates human from script from agent, and an agent records the
 * human principal behind its token (spec 10.3). "An AI did it" is not an answer
 * an inspector accepts; "agent X acting for user Y" is.
 */

export interface AuditRow {
  readonly id: string
  readonly occurredAt: string
  readonly actorKind: 'human' | 'script' | 'agent'
  readonly actorId: string
  readonly actorPrincipalId: string | null
  readonly action: string
  readonly resourceType: string
  readonly resourceId: string
  readonly before: unknown
  readonly after: unknown
  readonly requestId: string | null
  readonly ip: string | null
}

export interface AuditQuery {
  readonly entityId: string
  /** Inclusive, ISO date or timestamp. */
  readonly from?: string | undefined
  /** Exclusive, so a day range is `from` to the next day and needs no clock. */
  readonly until?: string | undefined
  readonly resourceType?: string | undefined
  readonly resourceId?: string | undefined
  readonly actorId?: string | undefined
  readonly action?: string | undefined
  readonly limit?: number | undefined
  /** `occurred_at` of the last row of the previous page. */
  readonly after?: string | undefined
}

const COLUMNS = {
  id: auditLog.id,
  occurredAt: auditLog.occurredAt,
  actorKind: auditLog.actorKind,
  actorId: auditLog.actorId,
  actorPrincipalId: auditLog.actorPrincipalId,
  action: auditLog.action,
  resourceType: auditLog.resourceType,
  resourceId: auditLog.resourceId,
  before: auditLog.before,
  after: auditLog.after,
  requestId: auditLog.requestId,
  ip: auditLog.ip,
}

export class AuditRepository {
  constructor(private readonly tx: Transaction) {}

  async append(event: AuditEvent): Promise<void> {
    await this.tx.insert(auditLog).values({
      id: uuidv7(),
      entityId: event.entityId,
      actorKind: event.actor.kind,
      actorId: event.actor.id,
      actorPrincipalId: event.actor.principalId,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      before: event.before,
      after: event.after,
      requestId: event.requestId,
      ip: event.ip,
    })
  }

  /**
   * An event that belongs to no administration.
   *
   * Authenticating is not an act inside a set of books — it happens before one
   * is chosen, and a failed attempt on an address nobody recognises belongs to
   * no books at all. `entity_id` is nullable for exactly this, and the type on
   * `AuditEvent` stays `string` so that no ordinary caller can forget it.
   */
  async appendInstanceEvent(event: Omit<AuditEvent, 'entityId'>): Promise<void> {
    await this.tx.insert(auditLog).values({
      id: uuidv7(),
      entityId: null,
      actorKind: event.actor.kind,
      actorId: event.actor.id,
      actorPrincipalId: event.actor.principalId,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      before: event.before,
      after: event.after,
      requestId: event.requestId,
      ip: event.ip,
    })
  }

  private conditions(query: AuditQuery): SQL[] {
    const conditions: SQL[] = [eq(auditLog.entityId, query.entityId)]

    if (query.from !== undefined) conditions.push(gte(auditLog.occurredAt, query.from))
    if (query.until !== undefined) conditions.push(lt(auditLog.occurredAt, query.until))
    if (query.resourceType !== undefined) {
      conditions.push(eq(auditLog.resourceType, query.resourceType))
    }
    if (query.resourceId !== undefined) conditions.push(eq(auditLog.resourceId, query.resourceId))
    if (query.actorId !== undefined) conditions.push(eq(auditLog.actorId, query.actorId))
    if (query.action !== undefined) conditions.push(eq(auditLog.action, query.action))
    if (query.after !== undefined) conditions.push(lte(auditLog.occurredAt, query.after))

    return conditions
  }

  /**
   * Newest first, which is what somebody looking at a screen wants.
   *
   * Paged by `occurred_at` rather than by offset: an append-only table grows
   * under a reader, and an offset page silently skips rows when it does.
   */
  async list(query: AuditQuery): Promise<AuditRow[]> {
    return this.tx
      .select(COLUMNS)
      .from(auditLog)
      .where(and(...this.conditions(query)))
      .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
      .limit(Math.min(query.limit ?? 100, 1000))
  }

  /**
   * The whole log for a period, oldest first, as a stream.
   *
   * Oldest first because an export is read as a narrative, and streamed because
   * seven years of an active administration does not belong in one array — the
   * export exists precisely for the case where there is a lot of it.
   */
  async *stream(query: AuditQuery, batchSize = 1_000): AsyncGenerator<AuditRow> {
    let cursor: { occurredAt: string; id: string } | null = null

    for (;;) {
      const conditions = this.conditions(query)
      if (cursor !== null) {
        // A row-value comparison rather than a timestamp plus a filter: two
        // rows can share a microsecond, and `> occurred_at` would drop the
        // second one while `>= occurred_at` would repeat the first.
        conditions.push(
          sql`(${auditLog.occurredAt}, ${auditLog.id}) > (${cursor.occurredAt}::timestamptz, ${cursor.id}::uuid)`,
        )
      }

      const rows: AuditRow[] = await this.tx
        .select(COLUMNS)
        .from(auditLog)
        .where(and(...conditions))
        .orderBy(asc(auditLog.occurredAt), asc(auditLog.id))
        .limit(batchSize)

      for (const row of rows) yield row

      const last = rows[rows.length - 1]
      if (last === undefined || rows.length < batchSize) return
      cursor = { occurredAt: last.occurredAt, id: last.id }
    }
  }

  /** How many rows a period holds, so an export can say what it is about to be. */
  async count(query: AuditQuery): Promise<number> {
    const [row] = await this.tx
      .select({ total: sql<string>`count(*)` })
      .from(auditLog)
      .where(and(...this.conditions(query)))

    return Number(row?.total ?? '0')
  }
}
