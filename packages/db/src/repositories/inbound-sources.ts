import { uuidv7 } from '@klopt/core'
import { and, asc, eq } from 'drizzle-orm'
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
}): InboundSourceRow {
  return {
    ...row,
    config: (row.config ?? {}) as Record<string, unknown>,
    lastPolledAt: row.lastPolledAt?.toISOString() ?? null,
  }
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

  /** Every enabled source across every administration. What the poller walks. */
  async due(): Promise<InboundSourceRow[]> {
    const rows = await this.tx
      .select(COLUMNS)
      .from(inboundSources)
      .where(eq(inboundSources.enabled, true))
      .orderBy(asc(inboundSources.lastPolledAt), asc(inboundSources.id))

    return rows.map(toRow)
  }

  /**
   * One source with its credential.
   *
   * Its own method so that the ordinary reads cannot leak it by accident, and
   * so that a grep for where secrets are read has one answer.
   */
  async withSecret(
    sourceId: string,
  ): Promise<(InboundSourceRow & { secret: string | null }) | null> {
    const [row] = await this.tx
      .select({ ...COLUMNS, secret: inboundSources.secret })
      .from(inboundSources)
      .where(eq(inboundSources.id, sourceId))
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
  }): Promise<void> {
    await this.tx
      .update(inboundSources)
      .set({
        lastPolledAt: new Date(),
        lastError: request.failure,
        lastMessageCount: request.messageCount,
        ...(request.ok ? { cursor: request.cursor } : {}),
        updatedAt: new Date(),
      })
      .where(eq(inboundSources.id, request.sourceId))
  }
}
