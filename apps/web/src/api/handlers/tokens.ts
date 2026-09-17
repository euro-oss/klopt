import { GRANTABLE_SCOPES, PERMISSIONS } from '@klopt/core'
import { issueToken, listTokens, revokeOAuthClientFor, revokeTokenFor } from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import { recordAudit } from '../audit.js'
import type { IssueTokenBody } from '../schemas.js'

/**
 * API tokens, and the apps that hold them (spec 14).
 *
 * `tokens:manage` existed in the roles from the beginning and nothing ever
 * used it, so there was no way to issue a token or revoke one short of writing
 * SQL — while the README told people to do both under Toegang, and the OAuth
 * flow had just started minting them.
 *
 * ## The secret is shown once
 *
 * Only a hash is stored, so there is no second chance to read it and no
 * endpoint that could return it. A screen that could show a token again is a
 * screen that leaks every token to anybody who gets a session.
 */

type TokenState = 'live' | 'expired' | 'revoked'

function stateOf(revokedAt: Date | null, expiresAt: Date | null, now: number): TokenState {
  if (revokedAt !== null) return 'revoked'
  if (expiresAt !== null && expiresAt.getTime() <= now) return 'expired'
  return 'live'
}

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

function requireIdempotencyKey(context: RequestContext): string {
  if (context.idempotencyKey === null || context.idempotencyKey === '') {
    throw new ApiError('idempotency_key_required', 'Every write needs an Idempotency-Key header.')
  }
  return context.idempotencyKey
}

export async function handleListTokens(context: RequestContext) {
  requirePermission(context, PERMISSIONS.manageTokens)

  const rows = await listTokens(context.database, context.entityId)
  const now = Date.now()

  return {
    status: 200,
    body: {
      tokens: rows.map((row) => ({
        id: row.id,
        name: row.name,
        // The first few characters, which is how somebody matches a row here to
        // the token in a config file without either of them being the secret.
        prefix: row.prefix,
        permissions: row.permissions,
        actorKind: row.actorKind,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
        // Three states, and a screen that showed only "revoked or not" would
        // call an hour-old OAuth token live.
        state: stateOf(row.revokedAt, row.expiresAt, now),
        oauthClientId: row.oauthClientId,
        oauthClientName: row.oauthClientName,
      })),
      grantableScopes: [...GRANTABLE_SCOPES],
    },
  }
}

export async function handleIssueToken(context: RequestContext, body: IssueTokenBody) {
  requirePermission(context, PERMISSIONS.manageTokens)
  requireIdempotencyKey(context)

  // A token cannot be given more than the person issuing it holds. Otherwise
  // `tokens:manage` is a way to escalate: mint a token with `payments:approve`
  // and present it back.
  const beyond = body.permissions.filter((permission) => !hasPermission(context, permission))
  if (beyond.length > 0) {
    throw new ApiError(
      'forbidden',
      'A token cannot be given permissions you do not have yourself.',
      beyond.map((permission) => ({
        code: 'permission_not_held',
        path: 'permissions',
        message: `You do not hold ${permission}.`,
      })),
    )
  }

  const issued = await issueToken(context.database, {
    entityId: context.entityId,
    name: body.name,
    permissions: body.permissions,
    // A token issued by a human is a script acting for that human: the audit
    // trail should say which person's token posted an entry.
    actorKind: 'script',
    actorId: `token:${body.name}`,
    principalId: context.actor.id,
    expiresAt: body.expiresInDays === null ? null : dayFromNow(body.expiresInDays),
  })

  await recordAudit(context, {
    action: 'tokens.issue',
    resourceType: 'api_token',
    resourceId: issued.id,
    after: { name: body.name, permissions: body.permissions, prefix: issued.prefix },
  })

  return {
    status: 201,
    body: {
      id: issued.id,
      name: body.name,
      prefix: issued.prefix,
      permissions: body.permissions,
      // The only time this is ever returned.
      token: issued.token,
    },
  }
}

function dayFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

export async function handleRevokeToken(context: RequestContext, tokenId: string) {
  requirePermission(context, PERMISSIONS.manageTokens)

  const revoked = await revokeTokenFor(context.database, context.entityId, tokenId)
  if (!revoked) {
    // Not found rather than "already revoked": a token of another
    // administration must not be distinguishable from one that does not exist.
    throw new ApiError('not_found', 'No such token, or it was already revoked.')
  }

  await recordAudit(context, {
    action: 'tokens.revoke',
    resourceType: 'api_token',
    resourceId: tokenId,
    before: { revoked: false },
    after: { revoked: true },
  })

  return { status: 200, body: { id: tokenId, revoked: true } }
}

/**
 * Withdraw an authorised app.
 *
 * Its live tokens stop working. The registration stays, because that row is
 * what lets this screen say "Claude" next to the revoked token rather than an
 * opaque name — and because deleting it would buy nothing when registration is
 * open and every grant needs consent anyway.
 */
export async function handleRevokeOAuthClient(context: RequestContext, clientId: string) {
  requirePermission(context, PERMISSIONS.manageTokens)

  const result = await revokeOAuthClientFor(context.database, context.entityId, clientId)
  if (!result.known) {
    throw new ApiError('not_found', 'This administration has not authorised that app.')
  }

  await recordAudit(context, {
    action: 'tokens.revokeClient',
    resourceType: 'oauth_client',
    resourceId: clientId,
    before: { authorised: true },
    after: { authorised: false, tokensRevoked: result.tokensRevoked },
  })

  return { status: 200, body: { clientId, ...result } }
}
