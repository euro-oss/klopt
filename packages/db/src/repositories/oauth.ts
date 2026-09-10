import { createHash, randomBytes } from 'node:crypto'
import { uuidv7, type StoredCode } from '@klopt/core'
import { and, eq, isNull, lt } from 'drizzle-orm'
import type { Database, Transaction } from '../client.js'
import { oauthAuthorizationCodes, oauthClients } from '../schema/ledger.js'

/**
 * OAuth clients and authorization codes.
 *
 * Codes are hashed at rest with the same one-way treatment as API tokens: a
 * code lives sixty seconds, but a database dump lives longer than that.
 */

export interface ClientRegistration {
  readonly clientName: string
  readonly redirectUris: readonly string[]
  readonly registeredBy: string | null
}

export interface RegisteredClientRow {
  readonly clientId: string
  readonly clientName: string
  readonly redirectUris: readonly string[]
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export class OAuthRepository {
  constructor(private readonly tx: Transaction) {}

  async registerClient(request: ClientRegistration): Promise<RegisteredClientRow> {
    // Opaque and random. Nothing about a client id needs to be guessable or
    // meaningful, and a meaningful one invites somebody to guess the next.
    const clientId = `klopt_c_${randomBytes(16).toString('base64url')}`

    await this.tx.insert(oauthClients).values({
      id: uuidv7(),
      clientId,
      clientName: request.clientName,
      redirectUris: [...request.redirectUris],
      registeredBy: request.registeredBy,
    })

    return {
      clientId,
      clientName: request.clientName,
      redirectUris: request.redirectUris,
    }
  }

  async findClient(clientId: string): Promise<RegisteredClientRow | null> {
    const [row] = await this.tx
      .select({
        clientId: oauthClients.clientId,
        clientName: oauthClients.clientName,
        redirectUris: oauthClients.redirectUris,
      })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
      .limit(1)

    return row ?? null
  }

  /** Issue a code. Returns the plaintext once; only the hash is kept. */
  async createCode(request: {
    readonly clientId: string
    readonly redirectUri: string
    readonly codeChallenge: string
    readonly resource: string | null
    readonly scope: readonly string[]
    readonly userId: string
    readonly entityId: string
    readonly expiresAt: Date
  }): Promise<string> {
    const code = randomBytes(32).toString('base64url')

    await this.tx.insert(oauthAuthorizationCodes).values({
      id: uuidv7(),
      codeHash: hash(code),
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      resource: request.resource,
      scope: [...request.scope],
      userId: request.userId,
      entityId: request.entityId,
      expiresAt: request.expiresAt,
    })

    return code
  }

  async findCode(code: string): Promise<StoredCode | null> {
    const [row] = await this.tx
      .select({
        clientId: oauthAuthorizationCodes.clientId,
        redirectUri: oauthAuthorizationCodes.redirectUri,
        codeChallenge: oauthAuthorizationCodes.codeChallenge,
        resource: oauthAuthorizationCodes.resource,
        scope: oauthAuthorizationCodes.scope,
        userId: oauthAuthorizationCodes.userId,
        entityId: oauthAuthorizationCodes.entityId,
        expiresAt: oauthAuthorizationCodes.expiresAt,
        consumedAt: oauthAuthorizationCodes.consumedAt,
      })
      .from(oauthAuthorizationCodes)
      .where(eq(oauthAuthorizationCodes.codeHash, hash(code)))
      .limit(1)

    if (row === undefined) return null

    return {
      ...row,
      expiresAt: row.expiresAt.toISOString(),
      consumedAt: row.consumedAt?.toISOString() ?? null,
    }
  }

  /**
   * Spend a code, and say whether this call is the one that spent it.
   *
   * The `consumed_at is null` in the where clause is the whole guarantee: two
   * concurrent redemptions both read an unconsumed row, and exactly one of them
   * updates it. Checking first and updating after would let both through.
   */
  async consumeCode(code: string, now: Date): Promise<boolean> {
    const updated = await this.tx
      .update(oauthAuthorizationCodes)
      .set({ consumedAt: now })
      .where(
        and(
          eq(oauthAuthorizationCodes.codeHash, hash(code)),
          // Must be `isNull`. `eq(consumedAt, consumedAt)` is `NULL = NULL`,
          // which is false for exactly the unconsumed rows this needs to match
          // and true for the spent ones it must refuse — the single-use
          // guarantee inverted.
          isNull(oauthAuthorizationCodes.consumedAt),
        ),
      )
      .returning({ id: oauthAuthorizationCodes.id })

    return updated.length > 0
  }

  async touchClient(clientId: string, now: Date): Promise<void> {
    await this.tx
      .update(oauthClients)
      .set({ lastUsedAt: now })
      .where(eq(oauthClients.clientId, clientId))
  }

  /** Codes that can no longer be redeemed. Housekeeping for the worker. */
  async purgeExpiredCodes(before: Date): Promise<number> {
    const removed = await this.tx
      .delete(oauthAuthorizationCodes)
      .where(lt(oauthAuthorizationCodes.expiresAt, before))
      .returning({ id: oauthAuthorizationCodes.id })

    return removed.length
  }
}

export async function withOAuth<T>(
  database: Database,
  work: (repository: OAuthRepository) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => work(new OAuthRepository(tx)))
}
