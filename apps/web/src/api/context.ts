import type { Actor } from '@klopt/core'
import type { Database } from '@klopt/db'

/**
 * What every API call resolves before the domain sees it (spec 11.1).
 *
 * Actor, entity and permissions are resolved in middleware and passed to the
 * domain as explicit arguments. `@klopt/core` has no ambient context and no way
 * to ask who is calling — which is what makes it testable without a server, and
 * what stops a permission check from quietly living in the wrong layer.
 */
export interface RequestContext {
  readonly database: Database
  readonly actor: Actor
  readonly entityId: string
  readonly permissions: ReadonlySet<string>
  readonly requestId: string
  readonly ip: string | null
  /** Client-supplied. Required on writes. */
  readonly idempotencyKey: string | null
}

export function hasPermission(context: RequestContext, permission: string): boolean {
  if (context.permissions.has('*')) return true
  if (context.permissions.has(permission)) return true

  // `ledger:*` grants `ledger:post`. One level, no deeper wildcards: a
  // permission language nobody can reason about is a permission language that
  // grants too much.
  const [scope] = permission.split(':')
  return scope !== undefined && context.permissions.has(`${scope}:*`)
}

/**
 * Soft-closed periods are accountant-only (spec 6.4). The domain does not know
 * what an accountant is, so the answer is resolved here and passed in.
 */
export function mayPostToSoftClosedPeriod(context: RequestContext): boolean {
  return hasPermission(context, 'ledger:post-closed')
}
