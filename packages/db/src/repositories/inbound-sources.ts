import { uuidv7 } from '@klopt/core'
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { inboundSources } from '../schema/documents.js'

/**
 * The mailboxes and access points an administration receives documents on.
 *
 * Two things here are deliberate.
 *
 * **The secret never comes back with the rest.** `list` is what a settings
 * screen and a status page read, and neither of them needs a password to do
 * their job. `withSecret` is a separate call the poller makes, so that the
 * credential travels the shortest path there is between the database and the
 * adapter that needs it.
 *
 * **A poll's outcome is recorded whether it worked or not.** A mailbox that has
 * been refusing a password for a week should say so on the screen, not in a log
 * file nobody has opened. That is spec 8's third rule — every adapter records
 * every request and response — applied to something that runs unattended.
 */

export interface InboundSourceRow {
  readonly id: string
  readonly entityId: string
  readonly kind: 'maildir' | 'imap' | 'peppol'
  readonly name: string
  readonly enabled: boolean
  readonly config: Record<string, unknown>
  readonly cursor: string | null
  readonly lastPolledAt: string | null
  readonly lastError: string | null
  readonly lastMessageCount: number
  readonly consecutiveFailures: number
  readonly nextPollAfter: string | null
}

const COLUMNS = {
  id: inboundSources.id,
  entityId: inboundSources.entityId,
  kind: inboundSources.kind,
  name: inboundSources.name,
  enabled: inboundSources.enabled,
  config: inboundSources.config,
  cursor: inboundSources.cursor,
  lastPolledAt: inboundSources.lastPolledAt,
  lastError: inboundSources.lastError,
  lastMessageCount: inboundSources.lastMessageCount,
  consecutiveFailures: inboundSources.consecutiveFailures,
  nextPollAfter: inboundSources.nextPollAfter,
}

function toRow(row: {
  id: string
  entityId: string
  kind: 'maildir' | 'imap' | 'peppol'
  name: string
  enabled: boolean
  config: unknown
  cursor: string | null
  lastPolledAt: Date | null
  lastError: string | null
  lastMessageCount: number
  consecutiveFailures: number
  nextPollAfter: Date | null
}): InboundSourceRow {
  return {
    ...row,
    config: (row.config ?? {}) as Record<string, unknown>,
    lastPolledAt: row.lastPolledAt?.toISOString() ?? null,
    nextPollAfter: row.nextPollAfter?.toISOString() ?? null,
  }
}

/**
 * How long to wait after a run of failures.
 *
 * Doubling from five minutes to a ceiling of six hours. A mailbox whose
 * password expired is worth retrying — somebody will fix it — but not
 * two hundred and eighty-eight times a day, and not while burying the source
 * that broke this morning.
 *
 * The ceiling rather than giving up: a drop directory can reappear, a network
 * can come back, and a source nobody has disabled is a source somebody still
 * wants.
 */
export function backoffFor(consecutiveFailures: number): number {
  const base = 5 * 60_000
  const ceiling = 6 * 60 * 60_000
  return Math.min(base * 2 ** Math.min(consecutiveFailures, 10), ceiling)
}

export class InboundSourceRepository {
  constructor(private readonly tx: Transaction) {}

  async list(entityId: string): Promise<InboundSourceRow[]> {
    const rows = await this.tx
      .select(COLUMNS)
      .from(inboundSources)
      .where(eq(inboundSources.entityId, entityId))
      .orderBy(asc(inboundSources.name))

    return rows.map(toRow)
  }

  /**
   * Every enabled source that is worth asking now.
   *
   * Not every enabled source: one that has been failing gets a widening gap
   * (see `backoffFor`), so a mailbox with a wrong password is retried rather
   * than hammered, and the log stays readable enough that a *new* failure is
   * visible in it.
   */
  async due(now: Date = new Date()): Promise<InboundSourceRow[]> {
    const rows = await this.tx
      .select(COLUMNS)
      .from(inboundSources)
      .where(
        and(
          eq(inboundSources.enabled, true),
          or(isNull(inboundSources.nextPollAfter), lte(inboundSources.nextPollAfter, now)),
        ),
      )
      .orderBy(asc(inboundSources.lastPolledAt), asc(inboundSources.id))

    return rows.map(toRow)
  }

  /**
   * One source with its credential.
   *
   * Its own method so that the ordinary reads cannot leak it by accident, and
   * so that a grep for where secrets are read has one answer.
   *
   * Scoped by entity here rather than by the caller comparing afterwards. It
   * was the second way round, and it worked — but a method that returns a
   * password and trusts every future caller to remember a check is the wrong
   * shape for the one query in this file that must not leak. The scope belongs
   * in the `where`.
   */
  async withSecret(
    entityId: string,
    sourceId: string,
  ): Promise<(InboundSourceRow & { secret: string | null }) | null> {
    const [row] = await this.tx
      .select({ ...COLUMNS, secret: inboundSources.secret })
      .from(inboundSources)
      .where(and(eq(inboundSources.entityId, entityId), eq(inboundSources.id, sourceId)))
      .limit(1)

    return row === undefined ? null : { ...toRow(row), secret: row.secret }
  }

  async create(request: {
    readonly entityId: string
    readonly kind: 'maildir' | 'imap' | 'peppol'
    readonly name: string
    readonly config: Record<string, unknown>
    readonly secret: string | null
  }): Promise<string> {
    const id = uuidv7()
    await this.tx.insert(inboundSources).values({
      id,
      entityId: request.entityId,
      kind: request.kind,
      name: request.name,
      config: request.config,
      secret: request.secret,
    })
    return id
  }

  async setEnabled(entityId: string, sourceId: string, enabled: boolean): Promise<void> {
    await this.tx
      .update(inboundSources)
      .set({ enabled, updatedAt: new Date() })
      .where(and(eq(inboundSources.entityId, entityId), eq(inboundSources.id, sourceId)))
  }

  async remove(entityId: string, sourceId: string): Promise<void> {
    await this.tx
      .delete(inboundSources)
      .where(and(eq(inboundSources.entityId, entityId), eq(inboundSources.id, sourceId)))
  }

  /**
   * What the last poll did.
   *
   * The cursor only moves on a poll that worked. A failed poll that advanced it
   * would skip everything that arrived while the mailbox was unreachable, which
   * is the one outcome worse than not polling at all.
   */
  async recordPoll(request: {
    readonly sourceId: string
    readonly ok: boolean
    readonly cursor: string | null
    readonly messageCount: number
    readonly failure: string | null
    /** What it was before this poll, so the next gap can widen. */
    readonly consecutiveFailures?: number
  }): Promise<void> {
    const now = new Date()

    await this.tx
      .update(inboundSources)
      .set({
        lastPolledAt: now,
        lastError: request.failure,
        lastMessageCount: request.messageCount,
        ...(request.ok ? { cursor: request.cursor } : {}),
        // A success clears the debt entirely: one working poll means whatever
        // was wrong has been fixed, and the next failure starts from scratch.
        ...(request.ok
          ? { consecutiveFailures: 0, nextPollAfter: null }
          : {
              consecutiveFailures: sql`${inboundSources.consecutiveFailures} + 1`,
              nextPollAfter: sql`now() + make_interval(secs => ${
                backoffFor(request.consecutiveFailures ?? 0) / 1000
              })`,
            }),
        updatedAt: now,
      })
      .where(eq(inboundSources.id, request.sourceId))
  }
}
