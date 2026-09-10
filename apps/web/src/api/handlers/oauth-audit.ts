import { withAudit, type Database } from '@klopt/db'
import { readAuthorizationRequest } from './oauth.js'

/**
 * An approval is a thing somebody did, so it goes in the audit log.
 *
 * Separate from `approveAuthorization` because that one is worth being able to
 * test without a database, and because the entry wants the actor and the
 * address — facts about the browser session rather than about the grant.
 *
 * Best-effort and loud, like `recordAudit`: the code has already been issued by
 * the time this runs, and failing the approval because the note failed would
 * be the worse outcome.
 */
export async function recordAuthorizationGrant(
  database: Database,
  options: {
    readonly entityId: string
    readonly userId: string
    readonly request: Request
    readonly query: string
  },
): Promise<void> {
  const parsed = readAuthorizationRequest(
    new URL(`${new URL(options.request.url).origin}/oauth/authorize?${options.query}`),
  )

  try {
    await withAudit(database, (repository) =>
      repository.append({
        entityId: options.entityId,
        actor: { kind: 'human', id: options.userId, principalId: null },
        action: 'oauth.approve',
        resourceType: 'oauth_client',
        resourceId: parsed.clientId,
        before: null,
        after: {
          clientId: parsed.clientId,
          redirectUri: parsed.redirectUri,
          scope: parsed.scope,
          resource: parsed.resource,
        },
        requestId: options.request.headers.get('x-request-id'),
        ip: options.request.headers.get('x-forwarded-for'),
      }),
    )
  } catch (error: unknown) {
    console.error('[audit] could not record oauth.approve', parsed.clientId, error)
  }
}
