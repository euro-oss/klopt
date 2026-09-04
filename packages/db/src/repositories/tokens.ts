import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { uuidv7, type ActorKind } from '@klopt/core'
import { and, eq } from 'drizzle-orm'
import type { Database, Transaction } from '../client.js'
import { apiTokens } from '../schema/index.js'

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
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.entityId, entityId)))
}
