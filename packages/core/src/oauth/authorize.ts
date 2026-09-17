import { createHash } from 'node:crypto'

/**
 * The parts of OAuth that are decisions rather than storage (spec 10.3).
 *
 * An MCP client cannot ask a human to pre-register it, so registration is open
 * and every client is a **public** client: no secret, nothing to authenticate
 * with. Everything that keeps an authorization code from being stolen and
 * redeemed by somebody else therefore lives here — PKCE, exact redirect
 * matching, single use, and audience binding.
 *
 * Pure on purpose. These are the rules a security review reads, and they should
 * be readable without a database.
 */

/** What the client asked for, straight off the query string. */
export interface AuthorizationRequest {
  readonly responseType: string
  readonly clientId: string
  readonly redirectUri: string
  readonly codeChallenge: string
  readonly codeChallengeMethod: string
  readonly scope: readonly string[]
  readonly state: string | null
  /** RFC 8707. Which resource the token is for. */
  readonly resource: string | null
}

export type AuthorizationFailure =
  | 'unsupported_response_type'
  | 'unknown_client'
  | 'redirect_uri_mismatch'
  | 'pkce_required'
  | 'pkce_method_unsupported'
  | 'invalid_scope'
  | 'resource_mismatch'

export interface AuthorizationRefusal {
  readonly error: AuthorizationFailure
  readonly description: string
  /**
   * Whether the refusal may be sent back to the client's redirect URI.
   *
   * Only once the client and its redirect are known good. Redirecting an error
   * to an unverified URI is the open redirect itself — it would let anybody
   * bounce a browser anywhere by inventing a client id.
   */
  readonly redirectable: boolean
}

/** A client as registered. Public: there is no secret to compare. */
export interface RegisteredClient {
  readonly clientId: string
  readonly clientName: string
  readonly redirectUris: readonly string[]
}

/**
 * Which scopes an OAuth token may carry.
 *
 * A deliberately short list, and read-only. The write operations exist and are
 * reachable with a token somebody issued by hand in Toegang; what is not on
 * offer is a browser flow that hands an agent the ability to post to the
 * ledger because a person clicked "allow" on a screen they skim-read.
 */
export const GRANTABLE_SCOPES: readonly string[] = ['ledger:read', 'ledger:export']

/**
 * Redirect URIs we will send a browser to.
 *
 * `https` anywhere, and `http` only on a loopback address — RFC 8252's rule for
 * native apps, which is what an MCP client on somebody's laptop is. A loopback
 * literal is required rather than the name `localhost`, because `localhost`
 * can be made to resolve elsewhere.
 *
 * No fragment: the fragment never reaches the server and a code placed in one
 * is a code in the browser's history.
 */
export function isUsableRedirectUri(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.hash !== '') return false
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false

  return url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1'
}

/** The S256 challenge for a verifier, base64url with no padding. */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/**
 * Whether a verifier matches the challenge a code was issued against.
 *
 * Length-checked before hashing: RFC 7636 requires 43–128 characters, and a
 * short verifier is guessable no matter how it compares.
 */
export function verifierMatches(verifier: string, challenge: string): boolean {
  if (verifier.length < 43 || verifier.length > 128) return false
  return timingSafeEqualText(challengeFor(verifier), challenge)
}

/** Constant-time comparison of two short ASCII strings. */
export function timingSafeEqualText(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

/**
 * Check an authorization request before showing anybody a consent screen.
 *
 * The order matters. The client and the redirect are validated first, because
 * until both are known good there is nowhere safe to send an error — so every
 * refusal above that line is `redirectable: false` and has to be rendered
 * rather than bounced.
 */
export function checkAuthorization(
  request: AuthorizationRequest,
  client: RegisteredClient | null,
  expectedResource: string,
): AuthorizationRefusal | null {
  if (client === null) {
    return {
      error: 'unknown_client',
      description: 'No client is registered with that id.',
      redirectable: false,
    }
  }

  // Exact match against the registered list. Not a prefix, not a host
  // comparison: `https://good.example/cb` and `https://good.example/cb/../..`
  // share a prefix and a host.
  if (!client.redirectUris.includes(request.redirectUri)) {
    return {
      error: 'redirect_uri_mismatch',
      description: 'That redirect URI is not registered for this client.',
      redirectable: false,
    }
  }

  // From here the redirect is trusted, so refusals can travel to it.
  if (request.responseType !== 'code') {
    return {
      error: 'unsupported_response_type',
      description: 'Only the authorization code flow is supported.',
      redirectable: true,
    }
  }

  if (request.codeChallenge === '') {
    return {
      error: 'pkce_required',
      description: 'PKCE is required: send code_challenge with method S256.',
      redirectable: true,
    }
  }

  if (request.codeChallengeMethod !== 'S256') {
    // `plain` puts the verifier in the same request that carries the
    // challenge, which defends against nothing.
    return {
      error: 'pkce_method_unsupported',
      description: 'Only S256 is supported for code_challenge_method.',
      redirectable: true,
    }
  }

  const unknown = request.scope.filter((scope) => !GRANTABLE_SCOPES.includes(scope))
  if (unknown.length > 0) {
    return {
      error: 'invalid_scope',
      description: `Not grantable over OAuth: ${unknown.join(', ')}. Available: ${GRANTABLE_SCOPES.join(', ')}.`,
      redirectable: true,
    }
  }

  // RFC 8707. A token minted for one instance must not be replayable against
  // another, which is the confused deputy the MCP authorization spec warns
  // about. Absent is tolerated for clients that predate it; wrong is not.
  if (request.resource !== null && !sameResource(request.resource, expectedResource)) {
    return {
      error: 'resource_mismatch',
      description: `This server issues tokens for ${expectedResource}.`,
      redirectable: true,
    }
  }

  return null
}

/** Compare two resource identifiers, ignoring a trailing slash. */
export function sameResource(left: string, right: string): boolean {
  const trim = (value: string): string => value.replace(/\/+$/, '')
  return trim(left) === trim(right)
}

/** The scopes to actually grant: what was asked for, or read-only by default. */
export function grantedScopes(requested: readonly string[]): readonly string[] {
  return requested.length === 0 ? ['ledger:read'] : requested
}
