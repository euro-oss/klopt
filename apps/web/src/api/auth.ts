import { uuidv7 } from '@klopt/core'
import { resolveToken, touchToken, type Database } from '@klopt/db'
import { ApiError } from './errors.js'
import type { RequestContext } from './context.js'

/**
 * Bearer-token authentication for `/api/v1`.
 *
 * A token is scoped to one entity and a set of permissions (spec 14), so the
 * accountant gets read plus export and nothing more. The entity comes from the
 * token rather than from the URL: a caller cannot reach another entity's books
 * by editing a path.
 */

export interface ResolveOptions {
  readonly database: Database
  readonly request: Request
  /** Best-effort; behind a proxy this is whatever the proxy was told. */
  readonly ip?: string | null
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header === null) return null
  const [scheme, ...rest] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return null
  const value = rest.join(' ').trim()
  return value === '' ? null : value
}

export async function resolveRequestContext(options: ResolveOptions): Promise<RequestContext> {
  const { database, request } = options
  const requestId = request.headers.get('x-request-id') ?? uuidv7()

  const token = bearer(request)
  if (token === null) {
    throw new ApiError('unauthenticated', 'A bearer token is required.')
  }

  const resolved = await resolveToken(database, token)
  if (resolved === null) {
    // Deliberately one message for unknown, revoked and expired: telling a
    // caller which one it was tells them something about a token they do not
    // hold.
    throw new ApiError('unauthenticated', 'The token is not valid.')
  }

  // Fire-and-forget: a failed bookkeeping write must not fail the request.
  void touchToken(database, resolved.id).catch(() => undefined)

  return {
    database,
    actor: {
      kind: resolved.actorKind,
      id: resolved.actorId,
      principalId: resolved.principalId,
    },
    entityId: resolved.entityId,
    permissions: new Set(resolved.permissions),
    requestId,
    ip: options.ip ?? request.headers.get('x-forwarded-for'),
    idempotencyKey: request.headers.get('idempotency-key'),
  }
}
