import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { uuidv7 } from '@klopt/core'
import type { Transaction } from '../client.js'
import { outbox } from '../schema/ledger.js'
import { webhookDeliveries, webhookEndpoints } from '../schema/webhooks.js'

/**
 * Webhook subscriptions and their delivery state (spec 10.2).
 *
 * See migration 0028 for why an endpoint carries a cursor rather than the
 * outbox carrying a row per subscriber. The short version: delivery is ordered
 * because an integration that hears "sent" before "issued" has to model a
 * world where effects precede causes, and almost none do.
 */

export interface EndpointRow {
  readonly id: string
  readonly entityId: string
  readonly url: string
  readonly eventTypes: readonly string[]
  readonly enabled: boolean
  readonly cursor: string | null
  readonly consecutiveFailures: number
  readonly disabledReason: string | null
  readonly lastAttemptAt: string | null
  readonly lastSuccessAt: string | null
  readonly createdAt: string
}

const COLUMNS = {
  id: webhookEndpoints.id,
  entityId: webhookEndpoints.entityId,
  url: webhookEndpoints.url,
  eventTypes: webhookEndpoints.eventTypes,
  enabled: webhookEndpoints.enabled,
  cursor: webhookEndpoints.cursor,
  consecutiveFailures: webhookEndpoints.consecutiveFailures,
  disabledReason: webhookEndpoints.disabledReason,
  lastAttemptAt: webhookEndpoints.lastAttemptAt,
  lastSuccessAt: webhookEndpoints.lastSuccessAt,
  createdAt: webhookEndpoints.createdAt,
}

export class WebhookRepository {
  constructor(private readonly tx: Transaction) {}

  async create(request: {
    readonly entityId: string
    readonly url: string
    /** Already encrypted. This repository does not hold the key. */
    readonly secret: string
    readonly eventTypes: readonly string[]
  }): Promise<string> {
    const id = uuidv7()
    await this.tx.insert(webhookEndpoints).values({
      id,
      entityId: request.entityId,
      url: request.url,
      secret: request.secret,
      eventTypes: [...request.eventTypes],
      // Null cursor: a new subscriber gets the history. Somebody connecting an
      // integration wants what happened, not only what happens next.
      cursor: null,
    })
    return id
  }

  async list(entityId: string): Promise<EndpointRow[]> {
    return this.tx
      .select(COLUMNS)
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.entityId, entityId))
      .orderBy(asc(webhookEndpoints.createdAt))
  }

  async remove(entityId: string, endpointId: string): Promise<void> {
    await this.tx
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.entityId, entityId), eq(webhookEndpoints.id, endpointId)))
  }

  /**
   * Switch it back on, and let it try again now.
   *
   * Clears the failure count as well as the reason: an operator pressing this
   * has done something about the cause, and starting them at seven failures
   * would disable it again on the next hiccup.
   */
  async enable(entityId: string, endpointId: string): Promise<void> {
    await this.tx
      .update(webhookEndpoints)
      .set({
        enabled: true,
        disabledReason: null,
        consecutiveFailures: 0,
        nextAttemptAfter: null,
      })
      .where(and(eq(webhookEndpoints.entityId, entityId), eq(webhookEndpoints.id, endpointId)))
  }

  /**
   * Send everything again from a point in the stream (spec 10.2's "replay
   * endpoint").
   *
   * Moving the cursor backwards, which is all a replay is. The receiver will
   * see events it has already seen — that is what at-least-once means, and why
   * the event id is a dedup key rather than decoration.
   */
  async rewind(entityId: string, endpointId: string, to: string | null): Promise<void> {
    await this.tx
      .update(webhookEndpoints)
      .set({ cursor: to, nextAttemptAfter: null, consecutiveFailures: 0 })
      .where(and(eq(webhookEndpoints.entityId, entityId), eq(webhookEndpoints.id, endpointId)))
  }

  /** Endpoints worth attempting now, with their secrets, for the worker. */
  async due(now: Date, limit = 50): Promise<(EndpointRow & { secret: string })[]> {
    return this.tx
      .select({ ...COLUMNS, secret: webhookEndpoints.secret })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.enabled, true),
          or(
            isNull(webhookEndpoints.nextAttemptAfter),
            lte(webhookEndpoints.nextAttemptAfter, now.toISOString()),
          ),
        ),
      )
      .orderBy(asc(webhookEndpoints.nextAttemptAfter))
      .limit(limit)
  }

  /**
   * The next events this endpoint has not seen.
   *
   * Filtered by type here rather than in the worker, so an endpoint subscribed
   * to one type does not drag the whole stream across the wire to discard it.
   */
  async pending(
    endpoint: EndpointRow,
    limit = 20,
  ): Promise<
    { id: string; occurredAt: string; type: string; version: number; payload: unknown }[]
  > {
    const conditions = [eq(outbox.entityId, endpoint.entityId)]
    if (endpoint.cursor !== null) conditions.push(gt(outbox.id, endpoint.cursor))
    if (endpoint.eventTypes.length > 0) {
      conditions.push(inArray(outbox.type, [...endpoint.eventTypes]))
    }

    return this.tx
      .select({
        id: outbox.id,
        occurredAt: outbox.occurredAt,
        type: outbox.type,
        version: outbox.version,
        payload: outbox.payload,
      })
      .from(outbox)
      .where(and(...conditions))
      .orderBy(asc(outbox.id))
      .limit(limit)
  }

  /** The cursor moves only on success, which is what keeps delivery ordered. */
  async advance(endpointId: string, to: string): Promise<void> {
    await this.tx
      .update(webhookEndpoints)
      .set({
        cursor: to,
        consecutiveFailures: 0,
        nextAttemptAfter: null,
        lastAttemptAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
      })
      .where(eq(webhookEndpoints.id, endpointId))
  }

  async scheduleRetry(endpointId: string, failures: number, afterSeconds: number): Promise<void> {
    await this.tx
      .update(webhookEndpoints)
      .set({
        consecutiveFailures: failures,
        nextAttemptAfter: new Date(Date.now() + afterSeconds * 1000).toISOString(),
        lastAttemptAt: new Date().toISOString(),
      })
      .where(eq(webhookEndpoints.id, endpointId))
  }

  async disable(endpointId: string, reason: string): Promise<void> {
    await this.tx
      .update(webhookEndpoints)
      .set({
        enabled: false,
        disabledReason: reason,
        nextAttemptAfter: null,
        lastAttemptAt: new Date().toISOString(),
      })
      .where(eq(webhookEndpoints.id, endpointId))
  }

  async recordAttempt(attempt: {
    readonly entityId: string
    readonly endpointId: string
    readonly eventId: string
    readonly attempt: number
    readonly responseStatus: number | null
    readonly error: string | null
    readonly durationMs: number
  }): Promise<void> {
    await this.tx.insert(webhookDeliveries).values({ id: uuidv7(), ...attempt })
  }

  /** The recent attempts for one endpoint, newest first. What an operator reads. */
  async attemptsFor(entityId: string, endpointId: string, limit = 20) {
    return this.tx
      .select({
        eventId: webhookDeliveries.eventId,
        attempt: webhookDeliveries.attempt,
        responseStatus: webhookDeliveries.responseStatus,
        error: webhookDeliveries.error,
        durationMs: webhookDeliveries.durationMs,
        at: webhookDeliveries.at,
      })
      .from(webhookDeliveries)
      .where(
        and(eq(webhookDeliveries.entityId, entityId), eq(webhookDeliveries.endpointId, endpointId)),
      )
      .orderBy(desc(webhookDeliveries.at))
      .limit(limit)
  }

  /** How far behind this endpoint is, for the screen. */
  async backlogFor(endpoint: EndpointRow): Promise<number> {
    const conditions = [eq(outbox.entityId, endpoint.entityId)]
    if (endpoint.cursor !== null) conditions.push(gt(outbox.id, endpoint.cursor))
    if (endpoint.eventTypes.length > 0) {
      conditions.push(inArray(outbox.type, [...endpoint.eventTypes]))
    }

    const [row] = await this.tx
      .select({ count: sql<string>`count(*)` })
      .from(outbox)
      .where(and(...conditions))

    return Number(row?.count ?? '0')
  }
}
