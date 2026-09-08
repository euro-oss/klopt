import { uuidv7 } from '@klopt/core'
import { and, eq } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { exactConnections } from '../schema/documents.js'
import { decryptSecret, encryptSecret } from '../secrets.js'

/**
 * The connection to an Exact Online administration (spec 13).
 *
 * Two rules run through this file, and both are about the same hazard.
 *
 * **The credentials never come back with the rest.** `find` is what a settings
 * screen reads and it returns no secret, no token and no client secret.
 * `withCredentials` is the one method that decrypts, so a grep for where these
 * secrets are read has exactly one answer — the same shape as
 * `InboundSourceRepository.withSecret`, and for the same reason.
 *
 * **Every method takes the entity.** The scope is in the `where`, never in the
 * caller comparing an id afterwards (ADR 0033).
 */

export interface ExactConnectionRow {
  readonly id: string
  readonly entityId: string
  readonly baseUrl: string
  readonly clientId: string
  readonly redirectUri: string
  readonly userName: string | null
  readonly divisionCode: number | null
  readonly divisionName: string | null
  readonly divisionCautions: readonly string[]
  readonly connected: boolean
  readonly accessTokenExpiresAt: string | null
  readonly lastImportAt: string | null
  readonly lastError: string | null
}

/** The same row with the secrets, for the client and nothing else. */
export interface ExactConnectionCredentials extends ExactConnectionRow {
  readonly clientSecret: string
  readonly refreshToken: string | null
  readonly accessToken: string | null
}

const PUBLIC_COLUMNS = {
  id: exactConnections.id,
  entityId: exactConnections.entityId,
  baseUrl: exactConnections.baseUrl,
  clientId: exactConnections.clientId,
  redirectUri: exactConnections.redirectUri,
  userName: exactConnections.userName,
  divisionCode: exactConnections.divisionCode,
  divisionName: exactConnections.divisionName,
  divisionCautions: exactConnections.divisionCautions,
  refreshToken: exactConnections.refreshToken,
  accessTokenExpiresAt: exactConnections.accessTokenExpiresAt,
  lastImportAt: exactConnections.lastImportAt,
  lastError: exactConnections.lastError,
}

interface RawRow {
  id: string
  entityId: string
  baseUrl: string
  clientId: string
  redirectUri: string
  userName: string | null
  divisionCode: number | null
  divisionName: string | null
  divisionCautions: unknown
  refreshToken: string | null
  accessTokenExpiresAt: Date | null
  lastImportAt: Date | null
  lastError: string | null
}

function toRow(row: RawRow): ExactConnectionRow {
  return {
    id: row.id,
    entityId: row.entityId,
    baseUrl: row.baseUrl,
    clientId: row.clientId,
    redirectUri: row.redirectUri,
    userName: row.userName,
    divisionCode: row.divisionCode,
    divisionName: row.divisionName,
    divisionCautions: Array.isArray(row.divisionCautions) ? (row.divisionCautions as string[]) : [],
    // "Connected" means there is a refresh token to trade, which is a different
    // question from whether the access token has expired — it always has.
    connected: row.refreshToken !== null,
    accessTokenExpiresAt: row.accessTokenExpiresAt?.toISOString() ?? null,
    lastImportAt: row.lastImportAt?.toISOString() ?? null,
    lastError: row.lastError,
  }
}

export class ExactConnectionRepository {
  constructor(private readonly tx: Transaction) {}

  async find(entityId: string): Promise<ExactConnectionRow | null> {
    const [row] = await this.tx
      .select(PUBLIC_COLUMNS)
      .from(exactConnections)
      .where(eq(exactConnections.entityId, entityId))
      .limit(1)

    return row === undefined ? null : toRow(row)
  }

  /**
   * The row with its secrets decrypted.
   *
   * Its own method so the ordinary reads cannot leak them, and scoped by entity
   * so no caller has to remember a check.
   */
  async withCredentials(entityId: string): Promise<ExactConnectionCredentials | null> {
    const [row] = await this.tx
      .select({
        ...PUBLIC_COLUMNS,
        clientSecret: exactConnections.clientSecret,
        accessToken: exactConnections.accessToken,
      })
      .from(exactConnections)
      .where(eq(exactConnections.entityId, entityId))
      .limit(1)

    if (row === undefined) return null

    return {
      ...toRow(row),
      clientSecret: decryptSecret(row.clientSecret) ?? '',
      refreshToken: decryptSecret(row.refreshToken),
      accessToken: decryptSecret(row.accessToken),
    }
  }

  /**
   * Register the OAuth app, replacing anything already there.
   *
   * Replacing rather than editing, because changing the client id makes every
   * stored token meaningless — they were issued to a different app. Keeping the
   * old refresh token would leave a connection that fails at the next refresh
   * with an error nobody can explain.
   */
  async upsertApp(request: {
    readonly entityId: string
    readonly baseUrl: string
    readonly clientId: string
    readonly clientSecret: string
    readonly redirectUri: string
  }): Promise<string> {
    const secret = encryptSecret(request.clientSecret)
    const existing = await this.find(request.entityId)

    if (existing !== null) {
      await this.tx
        .update(exactConnections)
        .set({
          baseUrl: request.baseUrl,
          clientId: request.clientId,
          clientSecret: secret,
          redirectUri: request.redirectUri,
          // The tokens belonged to the previous app.
          refreshToken: null,
          accessToken: null,
          accessTokenExpiresAt: null,
          state: null,
          stateCreatedAt: null,
          userName: null,
          divisionCode: null,
          divisionName: null,
          divisionCautions: [],
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(exactConnections.entityId, request.entityId))
      return existing.id
    }

    const id = uuidv7()
    await this.tx.insert(exactConnections).values({
      id,
      entityId: request.entityId,
      baseUrl: request.baseUrl,
      clientId: request.clientId,
      clientSecret: secret,
      redirectUri: request.redirectUri,
    })
    return id
  }

  /** Start a handshake. The nonce is the only thing tying the callback to it. */
  async beginHandshake(entityId: string, state: string): Promise<void> {
    await this.tx
      .update(exactConnections)
      .set({ state, stateCreatedAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(exactConnections.entityId, entityId))
  }

  /**
   * Spend the nonce, returning the row only if it matches.
   *
   * One statement rather than a read and a compare: two callbacks arriving with
   * the same state would both pass a check-then-act, and this way the second
   * finds nothing to clear.
   */
  async consumeHandshake(
    entityId: string,
    state: string,
  ): Promise<ExactConnectionCredentials | null> {
    const cleared = await this.tx
      .update(exactConnections)
      .set({ state: null, stateCreatedAt: null, updatedAt: new Date() })
      .where(and(eq(exactConnections.entityId, entityId), eq(exactConnections.state, state)))
      .returning({ id: exactConnections.id })

    if (cleared.length === 0) return null
    return this.withCredentials(entityId)
  }

  /**
   * Write down a new token pair.
   *
   * Called before the access token is used, every time. Exact kills the old
   * refresh token the instant it issues a new one, so a pair that is used
   * before it is stored leaves a dead connection behind if anything fails in
   * between.
   */
  async storeTokens(request: {
    readonly entityId: string
    readonly accessToken: string
    readonly refreshToken: string
    readonly expiresAt: string
  }): Promise<void> {
    await this.tx
      .update(exactConnections)
      .set({
        accessToken: encryptSecret(request.accessToken),
        refreshToken: encryptSecret(request.refreshToken),
        accessTokenExpiresAt: new Date(request.expiresAt),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(exactConnections.entityId, request.entityId))
  }

  async setUser(entityId: string, userName: string): Promise<void> {
    await this.tx
      .update(exactConnections)
      .set({ userName, updatedAt: new Date() })
      .where(eq(exactConnections.entityId, entityId))
  }

  /** Record which administration was chosen, and what was odd about it. */
  async chooseDivision(request: {
    readonly entityId: string
    readonly code: number
    readonly name: string
    readonly cautions: readonly string[]
  }): Promise<void> {
    await this.tx
      .update(exactConnections)
      .set({
        divisionCode: request.code,
        divisionName: request.name,
        divisionCautions: [...request.cautions],
        updatedAt: new Date(),
      })
      .where(eq(exactConnections.entityId, request.entityId))
  }

  async recordFailure(entityId: string, failure: string): Promise<void> {
    await this.tx
      .update(exactConnections)
      .set({ lastError: failure, updatedAt: new Date() })
      .where(eq(exactConnections.entityId, entityId))
  }

  async recordImport(entityId: string): Promise<void> {
    await this.tx
      .update(exactConnections)
      .set({ lastImportAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(exactConnections.entityId, entityId))
  }

  /**
   * Forget the connection entirely.
   *
   * Deleting the row rather than blanking the tokens: what is left otherwise is
   * a client id and a redirect URI belonging to an app nobody is using, which
   * is a thing to explain rather than a thing to keep.
   */
  async remove(entityId: string): Promise<void> {
    await this.tx.delete(exactConnections).where(eq(exactConnections.entityId, entityId))
  }
}
