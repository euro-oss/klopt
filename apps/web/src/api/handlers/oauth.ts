import {
  CODE_LIFETIME_MS,
  GRANTABLE_SCOPES,
  TOKEN_LIFETIME_MS,
  checkAuthorization,
  checkRedemption,
  grantedScopes,
  isUsableRedirectUri,
  type AuthorizationRequest,
  type RedemptionRequest,
} from '@klopt/core'
import { issueToken, withOAuth } from '@klopt/db'
import { getDatabase } from '../database.js'

/**
 * The authorization server (spec 10.3, MCP authorization).
 *
 * Klopt is both the resource and the authorization server, which for a
 * self-hosted bookkeeping system is the only arrangement that makes sense —
 * there is no separate IdP to defer to, and the people who may read the books
 * are exactly the people who already have an account here.
 *
 * ## An access token is an API token
 *
 * The flow ends by calling `issueToken`, the same function Toegang calls. So an
 * OAuth token is an ordinary `klopt_` bearer token with an expiry and a scope
 * list, and everything downstream — permission checks, entity scoping, the
 * audit trail, revocation from the Toegang screen — is the machinery that
 * already exists rather than a second one that has to be kept in agreement.
 *
 * That is also why there is no refresh token. A refresh token is a long-lived
 * credential held by a client we did not write; re-running a flow that is two
 * clicks for somebody already signed in costs less than that.
 *
 * ## What it will not grant
 *
 * Read and export, and nothing else. The write operations are reachable with a
 * token somebody issued deliberately in Toegang; what is not on offer is a
 * browser flow that hands an agent the ledger because a person clicked "allow"
 * on a screen they skim-read.
 */

/** Where this instance is, as everything else here already computes it. */
export function baseUrlFrom(request: Request): string {
  const configured = process.env['KLOPT_BASE_URL']
  if (configured !== undefined && configured !== '') return configured.replace(/\/+$/, '')
  return new URL(request.url).origin
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Discovery documents are read by clients that have no session and no
      // token, from a browser or a server, so they have to be fetchable.
      'access-control-allow-origin': '*',
      ...headers,
    },
  })

/**
 * RFC 9728, protected resource metadata.
 *
 * The document an MCP client fetches after a 401 to find out how to
 * authenticate. It names the authorization server — this instance — and the
 * scopes that mean anything here.
 */
export function protectedResourceMetadata(request: Request): Response {
  const base = baseUrlFrom(request)

  return json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: [...GRANTABLE_SCOPES],
    bearer_methods_supported: ['header'],
    resource_documentation: `${base}/api/v1/openapi.json`,
  })
}

/**
 * RFC 8414, authorization server metadata.
 *
 * Deliberately narrow. Only the authorization code grant, only S256, and no
 * `token_endpoint_auth_methods_supported` beyond `none`, because every client
 * here is a public client.
 */
export function authorizationServerMetadata(request: Request): Response {
  const base = baseUrlFrom(request)

  return json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: [...GRANTABLE_SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    // RFC 8707. Advertised so a client knows to bind its token to this
    // instance rather than sending one that works anywhere.
    resource_indicators_supported: true,
  })
}

/**
 * RFC 7591, dynamic client registration.
 *
 * Open, because it has to be: an MCP client cannot ask a human to pre-register
 * it, and requiring that would mean nobody can connect anything. What keeps
 * that safe is that registering is not a permission — a client id grants
 * nothing at all until a signed-in human approves a specific request on the
 * consent screen, and the redirect URIs are pinned at that moment.
 */
export async function handleRegisterClient(request: Request): Promise<Response> {
  let body: {
    client_name?: unknown
    redirect_uris?: unknown
    grant_types?: unknown
    token_endpoint_auth_method?: unknown
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'invalid_client_metadata', error_description: 'Body is not JSON.' }, 400)
  }

  const uris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((value): value is string => typeof value === 'string')
    : []

  if (uris.length === 0) {
    return json(
      {
        error: 'invalid_redirect_uri',
        error_description: 'At least one redirect_uri is required.',
      },
      400,
    )
  }

  const unusable = uris.filter((uri) => !isUsableRedirectUri(uri))
  if (unusable.length > 0) {
    return json(
      {
        error: 'invalid_redirect_uri',
        error_description: `Must be https, or http on a loopback literal (127.0.0.1 or ::1), and carry no fragment: ${unusable.join(', ')}`,
      },
      400,
    )
  }

  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') {
    return json(
      {
        error: 'invalid_client_metadata',
        error_description:
          'Only public clients are supported; use token_endpoint_auth_method=none.',
      },
      400,
    )
  }

  const name =
    typeof body.client_name === 'string' && body.client_name.trim() !== ''
      ? body.client_name.trim().slice(0, 120)
      : 'Naamloze client'

  const client = await withOAuth(getDatabase(), (repository) =>
    repository.registerClient({ clientName: name, redirectUris: uris, registeredBy: null }),
  )

  return json(
    {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    201,
  )
}

/** The query string of an authorize request, read without trusting it. */
export function readAuthorizationRequest(url: URL): AuthorizationRequest {
  const get = (key: string): string => url.searchParams.get(key) ?? ''

  return {
    responseType: get('response_type'),
    clientId: get('client_id'),
    redirectUri: get('redirect_uri'),
    codeChallenge: get('code_challenge'),
    codeChallengeMethod: get('code_challenge_method'),
    scope: get('scope')
      .split(/\s+/)
      .filter((value) => value !== ''),
    state: url.searchParams.get('state'),
    resource: url.searchParams.get('resource'),
  }
}

export interface AuthorizationCheck {
  readonly request: AuthorizationRequest
  readonly clientName: string
  readonly scope: readonly string[]
  /** Set when the request cannot proceed. */
  readonly refusal: { readonly error: string; readonly description: string } | null
  /** Where to bounce the refusal, when that is safe. Null means render it. */
  readonly redirectTo: string | null
}

/** Validate an authorize request. Shared by the screen and the approval. */
export async function checkAuthorizationRequest(
  request: Request,
  url: URL,
): Promise<AuthorizationCheck> {
  const parsed = readAuthorizationRequest(url)
  const resource = `${baseUrlFrom(request)}/api/mcp`

  const client = await withOAuth(getDatabase(), (repository) =>
    repository.findClient(parsed.clientId),
  )

  const refusal = checkAuthorization(parsed, client, resource)

  if (refusal === null) {
    return {
      request: parsed,
      clientName: client?.clientName ?? '',
      scope: grantedScopes(parsed.scope),
      refusal: null,
      redirectTo: null,
    }
  }

  let redirectTo: string | null = null
  if (refusal.redirectable) {
    const target = new URL(parsed.redirectUri)
    target.searchParams.set('error', refusal.error)
    target.searchParams.set('error_description', refusal.description)
    if (parsed.state !== null) target.searchParams.set('state', parsed.state)
    redirectTo = target.href
  }

  return {
    request: parsed,
    clientName: client?.clientName ?? '',
    scope: grantedScopes(parsed.scope),
    refusal: { error: refusal.error, description: refusal.description },
    redirectTo,
  }
}

/**
 * Approve a request and hand back the redirect carrying the code.
 *
 * Called only after a signed-in human has seen the consent screen. The entity
 * comes from the session rather than the request: a client asking for one
 * administration and being given another is exactly the confusion this flow
 * exists to prevent.
 */
export async function approveAuthorization(
  request: Request,
  url: URL,
  approver: { readonly userId: string; readonly entityId: string },
  now: Date = new Date(),
): Promise<string> {
  const check = await checkAuthorizationRequest(request, url)
  if (check.refusal !== null) {
    throw new Error(`${check.refusal.error}: ${check.refusal.description}`)
  }

  const code = await withOAuth(getDatabase(), (repository) =>
    repository.createCode({
      clientId: check.request.clientId,
      redirectUri: check.request.redirectUri,
      codeChallenge: check.request.codeChallenge,
      resource: check.request.resource,
      scope: check.scope,
      userId: approver.userId,
      entityId: approver.entityId,
      expiresAt: new Date(now.getTime() + CODE_LIFETIME_MS),
    }),
  )

  const target = new URL(check.request.redirectUri)
  target.searchParams.set('code', code)
  if (check.request.state !== null) target.searchParams.set('state', check.request.state)
  return target.href
}

const tokenError = (error: string, description: string, status = 400): Response =>
  json({ error, error_description: description }, status, {
    // RFC 6749: the token endpoint must not be cached.
    'cache-control': 'no-store',
    pragma: 'no-cache',
  })

/**
 * Exchange a code for a token.
 *
 * No client secret to check — every client is public — so PKCE plus the
 * single-use code is the whole of it.
 */
export async function handleToken(request: Request, now: Date = new Date()): Promise<Response> {
  const form = await request.formData().catch(() => null)
  if (form === null) {
    return tokenError('invalid_request', 'Send application/x-www-form-urlencoded.')
  }

  const field = (key: string): string => {
    const value = form.get(key)
    return typeof value === 'string' ? value : ''
  }

  const redemption: RedemptionRequest = {
    grantType: field('grant_type'),
    code: field('code'),
    clientId: field('client_id'),
    redirectUri: field('redirect_uri'),
    codeVerifier: field('code_verifier'),
    resource: form.get('resource') === null ? null : field('resource'),
  }

  const resource = `${baseUrlFrom(request)}/api/mcp`
  const database = getDatabase()

  const stored = await withOAuth(database, (repository) => repository.findCode(redemption.code))
  const failure = checkRedemption(redemption, stored, now, resource)

  if (failure !== null) {
    // `invalid_grant` for everything about the code itself, which is what RFC
    // 6749 asks for and what stops the endpoint being an oracle for which part
    // was wrong.
    const code = failure.error === 'unsupported_grant_type' ? failure.error : 'invalid_grant'
    return tokenError(code, failure.description)
  }

  // Spend it. Losing this race means somebody else redeemed the same code in
  // the same instant, and neither of them should get a token.
  const spent = await withOAuth(database, (repository) =>
    repository.consumeCode(redemption.code, now),
  )
  if (!spent) {
    return tokenError('invalid_grant', 'That authorization code has already been redeemed.')
  }

  // Non-null: `checkRedemption` returned no failure, which it cannot do for a
  // missing code.
  const grant = stored!

  const issued = await issueToken(database, {
    entityId: grant.entityId,
    name: `OAuth: ${redemption.clientId}`,
    permissions: [...grant.scope],
    // An agent acting for the human who approved it. The audit trail records
    // both, which is the whole point of `principalId`.
    actorKind: 'agent',
    actorId: `oauth:${redemption.clientId}`,
    principalId: grant.userId,
    expiresAt: new Date(now.getTime() + TOKEN_LIFETIME_MS),
    // So Toegang can name what holds it, and so withdrawing the app can find
    // everything it was given.
    oauthClientId: redemption.clientId,
  })

  await withOAuth(database, (repository) => repository.touchClient(redemption.clientId, now))

  return json(
    {
      access_token: issued.token,
      token_type: 'Bearer',
      expires_in: Math.floor(TOKEN_LIFETIME_MS / 1000),
      scope: grant.scope.join(' '),
    },
    200,
    { 'cache-control': 'no-store', pragma: 'no-cache' },
  )
}
