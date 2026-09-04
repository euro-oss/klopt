import { PERMISSIONS, grants, type Actor } from '@klopt/core'
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

/**
 * The context for an operation that has no entity yet (spec 10.1).
 *
 * Creating an administration cannot carry an `entityId`, and it cannot be
 * authorised by an API token either: a token is issued by one administration,
 * and letting it create another would put a second tenant behind the first
 * one's credential. So this resolves from a session and nothing else, and the
 * only permission it can ever hold is `entity:create`.
 */
export interface SetupContext {
  readonly database: Database
  readonly user: { readonly id: string; readonly email: string }
  readonly permissions: ReadonlySet<string>
  readonly requestId: string
  readonly ip: string | null
}

export function hasSetupPermission(context: SetupContext, permission: string): boolean {
  return grants(context.permissions, permission)
}

export function hasPermission(context: RequestContext, permission: string): boolean {
  return grants(context.permissions, permission)
}

/**
 * Soft-closed periods are accountant-only (spec 6.4). The domain does not know
 * what an accountant is, so the answer is resolved here and passed in.
 */
export function mayPostToSoftClosedPeriod(context: RequestContext): boolean {
  return hasPermission(context, PERMISSIONS.postClosed)
}
