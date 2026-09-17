import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { uuidv7, type ActorKind } from '@klopt/core'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Database, Transaction } from '../client.js'
import { apiTokens, oauthClients } from '../schema/index.js'

/**
 * Scoped API tokens (spec 14).
 *
 * Only the hash is stored. A database dump does not hand anyone a working
 * credential, and a lost token can only be reissued, never recovered.
 */

const PREFIX = 'klopt_'
const TOKEN_BYTES = 32

export interface ResolvedToken {
  readonly id: string
  readonly entityId: string
  readonly permissions: readonly string[]
  readonly actorKind: ActorKind
  readonly actorId: string
  readonly principalId: string | null
}

export interface IssueTokenRequest {
  readonly entityId: string
  readonly name: string
  readonly permissions: readonly string[]
  readonly actorKind: ActorKind
  readonly actorId: string
  readonly principalId?: string | null
  readonly expiresAt?: Date | null
  /** Set when an OAuth exchange produced this token, so it can be traced back. */
  readonly oauthClientId?: string | null
}

export interface IssuedToken {
  readonly id: string
  /** Shown once, at issue time, and never again. */
  readonly token: string
  readonly prefix: string
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export async function issueToken(
  database: Database | Transaction,
  request: IssueTokenRequest,
): Promise<IssuedToken> {
  const secret = randomBytes(TOKEN_BYTES).toString('base64url')
  const token = `${PREFIX}${secret}`
  const id = uuidv7()

  await database.insert(apiTokens).values({
    id,
    entityId: request.entityId,
    name: request.name,
    tokenHash: hashToken(token),
    tokenPrefix: token.slice(0, PREFIX.length + 6),
    permissions: [...request.permissions],
    actorKind: request.actorKind,
    actorId: request.actorId,
    principalId: request.principalId ?? null,
    expiresAt: request.expiresAt ?? null,
    oauthClientId: request.oauthClientId ?? null,
  })

  return { id, token, prefix: token.slice(0, PREFIX.length + 6) }
}

/**
 * Resolve a bearer token. Returns null for anything unusable — unknown,
 * revoked or expired — without distinguishing between them to the caller.
 */
export async function resolveToken(
  database: Database,
  token: string,
  now: Date = new Date(),
): Promise<ResolvedToken | null> {
  if (!token.startsWith(PREFIX)) return null

  const [row] = await database
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hashToken(token)))
    .limit(1)

  if (row === undefined) return null
  if (row.revokedAt !== null) return null
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) return null

  // The lookup was by hash, so this is belt and braces rather than the primary
  // defence; it costs nothing and removes a class of comparison mistake.
  const expected = Buffer.from(row.tokenHash, 'hex')
  const actual = Buffer.from(hashToken(token), 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  return {
    id: row.id,
    entityId: row.entityId,
    permissions: row.permissions,
    actorKind: row.actorKind,
    actorId: row.actorId,
    principalId: row.principalId,
  }
}

export async function revokeToken(database: Database, id: string): Promise<void> {
  await database.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, id))
}

export async function touchToken(database: Database, id: string): Promise<void> {
  await database.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, id))
}

export async function listTokens(database: Database, entityId: string) {
  // Left-joined to the client, so a token obtained through OAuth says who holds
  // it. "Claude" is a different thing to revoke than "a script somebody wrote",
  // and the row is unreadable without it.
  return database
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.tokenPrefix,
      permissions: apiTokens.permissions,
      actorKind: apiTokens.actorKind,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
      oauthClientId: apiTokens.oauthClientId,
      oauthClientName: oauthClients.clientName,
    })
    .from(apiTokens)
    .leftJoin(oauthClients, eq(oauthClients.clientId, apiTokens.oauthClientId))
    .where(and(eq(apiTokens.entityId, entityId)))
    .orderBy(desc(apiTokens.createdAt))
}

/**
 * Revoke a token, scoped to the administration that owns it.
 *
 * `revokeToken` takes an id alone, which is right for the code path that
 * already knows the row. A handler acting on an id from a URL needs the entity
 * in the `where`, or one administration can revoke another's tokens by
 * guessing a uuid.
 */
export async function revokeTokenFor(
  database: Database,
  entityId: string,
  id: string,
): Promise<boolean> {
  const updated = await database
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.entityId, entityId), eq(apiTokens.id, id), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id })

  return updated.length > 0
}

/**
 * Withdraw an authorised app: revoke every live token it holds here.
 *
 * The registration row stays. Deleting it was the first attempt and the
 * foreign key refused — rightly, because `api_tokens.oauth_client_id` is what
 * lets Toegang say "Claude" next to a revoked token instead of an opaque name.
 * Removing the client would take the provenance with it.
 *
 * It would also buy nothing. Registration is open by necessity, so a deleted
 * client simply registers again with a new id; and every grant needs a human
 * at the consent screen regardless. What withdrawal actually means is "stop
 * the thing working now", and that is the tokens.
 */
export async function revokeOAuthClientFor(
  database: Database,
  entityId: string,
  clientId: string,
): Promise<{ readonly tokensRevoked: number; readonly known: boolean }> {
  const revoked = await database
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiTokens.entityId, entityId),
        eq(apiTokens.oauthClientId, clientId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ id: apiTokens.id })

  // Scoped to this administration throughout: a client id is global, and
  // answering on one somebody else authorised would confirm it exists.
  const held = await database
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(and(eq(apiTokens.entityId, entityId), eq(apiTokens.oauthClientId, clientId)))
    .limit(1)

  return { tokensRevoked: revoked.length, known: held.length > 0 }
}
