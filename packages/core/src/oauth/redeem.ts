import { sameResource, timingSafeEqualText, verifierMatches } from './authorize.js'

/**
 * Redeeming an authorization code for a token.
 *
 * Everything here is a check that something which was true when the code was
 * issued is still true now, and that the party redeeming it is the party it was
 * issued to. A public client has no secret, so this is the whole of the
 * client's authentication.
 */

/** A code as stored. Hashed elsewhere; this is the row it resolves to. */
export interface StoredCode {
  readonly clientId: string
  readonly redirectUri: string
  readonly codeChallenge: string
  readonly resource: string | null
  readonly scope: readonly string[]
  readonly userId: string
  readonly entityId: string
  readonly expiresAt: string
  readonly consumedAt: string | null
}

export interface RedemptionRequest {
  readonly grantType: string
  readonly code: string
  readonly clientId: string
  readonly redirectUri: string
  readonly codeVerifier: string
  readonly resource: string | null
}

export type RedemptionFailure =
  | 'unsupported_grant_type'
  | 'unknown_code'
  | 'code_expired'
  | 'code_already_used'
  | 'client_mismatch'
  | 'redirect_uri_mismatch'
  | 'pkce_failed'
  | 'resource_mismatch'

export interface Redemption {
  readonly error: RedemptionFailure
  readonly description: string
}

/**
 * Whether this code may be turned into a token.
 *
 * `code_already_used` is reported separately from `unknown_code` on purpose.
 * A replayed code is not a mistake, it is somebody redeeming a code that has
 * already been spent — which means it leaked. The caller's job is to revoke
 * everything that code produced, and it cannot do that if the two look alike.
 */
export function checkRedemption(
  request: RedemptionRequest,
  stored: StoredCode | null,
  now: Date,
  expectedResource: string,
): Redemption | null {
  if (request.grantType !== 'authorization_code') {
    return {
      error: 'unsupported_grant_type',
      description: 'Only authorization_code is supported.',
    }
  }

  if (stored === null) {
    return { error: 'unknown_code', description: 'No such authorization code.' }
  }

  if (stored.consumedAt !== null) {
    return {
      error: 'code_already_used',
      description: 'That authorization code has already been redeemed.',
    }
  }

  if (Date.parse(stored.expiresAt) <= now.getTime()) {
    return { error: 'code_expired', description: 'That authorization code has expired.' }
  }

  // The client the code was issued to is the only one that may spend it.
  if (!timingSafeEqualText(request.clientId, stored.clientId)) {
    return {
      error: 'client_mismatch',
      description: 'That code was issued to a different client.',
    }
  }

  if (request.redirectUri !== stored.redirectUri) {
    return {
      error: 'redirect_uri_mismatch',
      description: 'The redirect URI does not match the one the code was issued for.',
    }
  }

  // PKCE. With no client secret this is what proves the redeemer is the same
  // party that started the flow rather than whoever intercepted the code.
  if (!verifierMatches(request.codeVerifier, stored.codeChallenge)) {
    return { error: 'pkce_failed', description: 'The code verifier does not match.' }
  }

  const wanted = request.resource ?? stored.resource
  if (wanted !== null && !sameResource(wanted, expectedResource)) {
    return {
      error: 'resource_mismatch',
      description: `This server issues tokens for ${expectedResource}.`,
    }
  }

  return null
}

/** How long an authorization code is good for. */
export const CODE_LIFETIME_MS = 60_000

/**
 * How long the token it produces lasts.
 *
 * An hour, and no refresh token. A refresh token is a long-lived credential in
 * a client we did not write and cannot revoke individually; re-running a flow
 * that is two clicks for somebody already signed in is a smaller cost than
 * that. If agents start being disconnected mid-task this is the number to
 * revisit, deliberately.
 */
export const TOKEN_LIFETIME_MS = 60 * 60_000
