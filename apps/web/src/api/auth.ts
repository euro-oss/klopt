import { grants, permissionsForRole, uuidv7, isRole } from '@klopt/core'
import {
  activeEntityFor,
  membershipFor,
  membershipsFor,
  resolveToken,
  touchToken,
  type Database,
} from '@klopt/db'
import { ApiError } from './errors.js'
import type { RequestContext } from './context.js'
import { getAuth } from './auth-instance.js'

/**
 * Two ways in, one shape out.
 *
 * A **bearer token** is a machine: scoped to one entity and an explicit
 * permission list (spec 14). A **session cookie** is a human: their role in the
 * entity they are looking at expands to the same permission strings.
 *
 * Everything downstream — handlers, the domain, the audit log — sees a
 * `RequestContext` and cannot tell which it was. That is what makes principle 3
 * true rather than aspirational: the UI is a client with no privileged path,
 * because there is no privileged path to have.
 */

export interface ResolveOptions {
  readonly database: Database
  readonly request: Request
  readonly ip?: string | null
  /** Overrides the session's remembered entity, for an explicit switch. */
  readonly entityId?: string | null
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header === null) return null
  const [scheme, ...rest] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return null
  const value = rest.join(' ').trim()
  return value === '' ? null : value
}

async function fromToken(
  options: ResolveOptions,
  token: string,
  requestId: string,
): Promise<RequestContext> {
  const resolved = await resolveToken(options.database, token)
  if (resolved === null) {
    // One message for unknown, revoked and expired: telling a caller which it
    // was tells them something about a token they do not hold.
    throw new ApiError('unauthenticated', 'The token is not valid.')
  }

  void touchToken(options.database, resolved.id).catch(() => undefined)

  return {
    database: options.database,
    actor: { kind: resolved.actorKind, id: resolved.actorId, principalId: resolved.principalId },
    entityId: resolved.entityId,
    permissions: new Set(resolved.permissions),
    requestId,
    ip: options.ip ?? options.request.headers.get('x-forwarded-for'),
    idempotencyKey: options.request.headers.get('idempotency-key'),
  }
}

async function fromSession(
  options: ResolveOptions,
  requestId: string,
): Promise<RequestContext | null> {
  // No cookie, no session. Checked before touching `getAuth()` so that a
  // credential-less request to a headless deployment — one that never
  // configured a session secret because it only ever serves tokens — gets a
  // 401 rather than a configuration error.
  if (options.request.headers.get('cookie') === null) return null

  const session = await getAuth().api.getSession({ headers: options.request.headers })
  if (session === null) return null

  const memberships = await membershipsFor(options.database, session.user.id)
  if (memberships.length === 0) {
    throw new ApiError(
      'forbidden',
      'This account is not a member of any entity. Ask an owner to invite you.',
    )
  }

  const remembered = await activeEntityFor(options.database, session.session.token)
  const entityId = options.entityId ?? remembered ?? memberships[0]!.entityId

  const membership = await membershipFor(options.database, session.user.id, entityId)
  if (membership === null) {
    // Not "you may not see this entity": a member of one entity should not be
    // able to probe which other entities exist.
    throw new ApiError('not_found', 'No such entity.')
  }
  if (!isRole(membership.role)) {
    throw new ApiError('internal_error', `Unknown role ${membership.role}.`)
  }

  return {
    database: options.database,
    actor: { kind: 'human', id: session.user.id, principalId: null },
    entityId: membership.entityId,
    permissions: new Set<string>(permissionsForRole(membership.role)),
    requestId,
    ip: options.ip ?? options.request.headers.get('x-forwarded-for'),
    idempotencyKey: options.request.headers.get('idempotency-key'),
  }
}

export async function resolveRequestContext(options: ResolveOptions): Promise<RequestContext> {
  const requestId = options.request.headers.get('x-request-id') ?? uuidv7()

  const token = bearer(options.request)
  if (token !== null) return fromToken(options, token, requestId)

  const session = await fromSession(options, requestId)
  if (session !== null) return session

  throw new ApiError('unauthenticated', 'Sign in, or present a bearer token.')
}

/** The entities this session may switch between, for the entity picker. */
export async function resolveMemberships(database: Database, request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (session === null) return null
  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    sessionToken: session.session.token,
    memberships: await membershipsFor(database, session.user.id),
  }
}

export { grants }
