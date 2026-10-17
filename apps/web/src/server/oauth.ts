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
    const { approveAuthorizationForSession } = await import('~/api/handlers/oauth')
    const { resolveMemberships } = await import('~/api/auth')
    const { getDatabase } = await import('~/api/database')
    const { recordAuthorizationGrant } = await import('~/api/handlers/oauth-audit')

    const request = getRequest()
    const database = getDatabase()
    const session = await resolveMemberships(database, request)
    if (session === null) throw new Error('Sign in first.')

    // Membership is checked inside approveAuthorizationForSession — the entity
    // comes from the signed-in user's own memberships, not from anything the
    // client sent.
    const url = new URL(`${new URL(request.url).origin}/oauth/authorize?${data.query}`)
    const approved = await approveAuthorizationForSession(
      request,
      url,
      {
        userId: session.user.id,
        memberships: session.memberships,
      },
      data.entityId,
    )

    await recordAuthorizationGrant(database, {
      entityId: approved.entityId,
      userId: session.user.id,
      request,
      query: data.query,
    })

    return { redirectTo: approved.redirectTo }
  })
