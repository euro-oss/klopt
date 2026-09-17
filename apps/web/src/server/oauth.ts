import { createServerFn } from '@tanstack/react-start'

/**
 * The consent screen's two server calls.
 *
 * The OAuth parameters travel as the raw query string rather than a parsed
 * object: they have to be validated on the server against the registered
 * client anyway, and re-parsing one string is less surface than trusting a
 * shape assembled in the browser.
 */

export const describeAuthorization = createServerFn({ method: 'GET' })
  .validator((input: { query: string }) => input)
  .handler(async ({ data }) => {
    const { getRequest } = await import('@tanstack/react-start/server')
    const { checkAuthorizationRequest } = await import('~/api/handlers/oauth')
    const { resolveMemberships } = await import('~/api/auth')
    const { getDatabase } = await import('~/api/database')

    const request = getRequest()
    const session = await resolveMemberships(getDatabase(), request)
    const url = new URL(`${new URL(request.url).origin}/oauth/authorize?${data.query}`)

    const check = await checkAuthorizationRequest(request, url)

    return {
      signedIn: session !== null,
      user: session?.user.email ?? null,
      memberships: session?.memberships.map((m) => ({ id: m.entityId, name: m.entityName })) ?? [],
      clientName: check.clientName,
      scope: [...check.scope],
      refusal: check.refusal,
      redirectTo: check.redirectTo,
    }
  })

export const approveAuthorizationRequest = createServerFn({ method: 'POST' })
  .validator((input: { query: string; entityId: string }) => input)
  .handler(async ({ data }) => {
    const { getRequest } = await import('@tanstack/react-start/server')
    const { approveAuthorization } = await import('~/api/handlers/oauth')
    const { resolveMemberships } = await import('~/api/auth')
    const { getDatabase } = await import('~/api/database')
    const { recordAuthorizationGrant } = await import('~/api/handlers/oauth-audit')

    const request = getRequest()
    const database = getDatabase()
    const session = await resolveMemberships(database, request)
    if (session === null) throw new Error('Sign in first.')

    // The administration comes from the signed-in user's own memberships, not
    // from anything the client sent. A client asking for one set of books and
    // being handed another is the confusion this whole flow exists to prevent.
    const membership = session.memberships.find((m) => m.entityId === data.entityId)
    if (membership === undefined) throw new Error('You are not a member of that administration.')

    const url = new URL(`${new URL(request.url).origin}/oauth/authorize?${data.query}`)
    const redirectTo = await approveAuthorization(request, url, {
      userId: session.user.id,
      entityId: membership.entityId,
    })

    await recordAuthorizationGrant(database, {
      entityId: membership.entityId,
      userId: session.user.id,
      request,
      query: data.query,
    })

    return { redirectTo }
  })
