import { describe, expect, it } from 'vitest'
import {
  challengeFor,
  checkAuthorization,
  checkRedemption,
  isUsableRedirectUri,
  sameResource,
  verifierMatches,
  type AuthorizationRequest,
  type RegisteredClient,
  type StoredCode,
} from '../../src/index.js'

/**
 * The rules a security review reads.
 *
 * Every client here is a public client — an MCP client on somebody's laptop
 * cannot keep a secret — so there is no password to get wrong. Everything that
 * stops a code being stolen and spent by somebody else is in these functions.
 */

const CLIENT: RegisteredClient = {
  clientId: 'klopt_c_abc',
  clientName: 'Claude',
  redirectUris: ['http://127.0.0.1:9876/callback'],
}

const RESOURCE = 'https://books.example.org/api/mcp'

const request = (overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest => ({
  responseType: 'code',
  clientId: CLIENT.clientId,
  redirectUri: CLIENT.redirectUris[0]!,
  codeChallenge: 'x'.repeat(43),
  codeChallengeMethod: 'S256',
  scope: ['ledger:read'],
  state: 'xyz',
  resource: RESOURCE,
  ...overrides,
})

describe('which redirect URIs are usable at all', () => {
  it('takes https anywhere', () => {
    expect(isUsableRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true)
  })

  it('takes http only on a loopback literal', () => {
    // RFC 8252: a native client listens on a random loopback port.
    expect(isUsableRedirectUri('http://127.0.0.1:51004/cb')).toBe(true)
    expect(isUsableRedirectUri('http://[::1]:51004/cb')).toBe(true)
  })

  it('refuses plain http anywhere else', () => {
    expect(isUsableRedirectUri('http://example.org/cb')).toBe(false)
  })

  it('refuses http://localhost, name resolution being somebody else’s decision', () => {
    // `localhost` can be pointed at another address; the literal cannot.
    expect(isUsableRedirectUri('http://localhost:51004/cb')).toBe(false)
  })

  it('refuses a fragment, which never reaches the server anyway', () => {
    expect(isUsableRedirectUri('https://app.example/cb#/done')).toBe(false)
  })

  it('refuses something that is not a URL', () => {
    expect(isUsableRedirectUri('not a url')).toBe(false)
  })
})

describe('what may be sent back to the client, and what may not', () => {
  it('will not redirect an error for an unknown client', () => {
    /**
     * The open redirect. If this were redirectable, anybody could bounce a
     * browser anywhere by inventing a client id — and the same door later
     * carries a real authorization code.
     */
    const refusal = checkAuthorization(request(), null, RESOURCE)

    expect(refusal?.error).toBe('unknown_client')
    expect(refusal?.redirectable).toBe(false)
  })

  it('will not redirect to a URI the client never registered', () => {
    const refusal = checkAuthorization(
      request({ redirectUri: 'http://127.0.0.1:9876/stolen' }),
      CLIENT,
      RESOURCE,
    )

    expect(refusal?.error).toBe('redirect_uri_mismatch')
    expect(refusal?.redirectable).toBe(false)
  })

  it('matches the redirect exactly, not by prefix', () => {
    // `…/callback` and `…/callback/../../x` share a prefix and a host.
    const refusal = checkAuthorization(
      request({ redirectUri: 'http://127.0.0.1:9876/callback/extra' }),
      CLIENT,
      RESOURCE,
    )

    expect(refusal?.error).toBe('redirect_uri_mismatch')
  })

  it('does redirect errors once the client and redirect are known good', () => {
    // Now there is somewhere safe to send it, and the client can only learn
    // what it did wrong if it gets told.
    const refusal = checkAuthorization(request({ codeChallenge: '' }), CLIENT, RESOURCE)

    expect(refusal?.error).toBe('pkce_required')
    expect(refusal?.redirectable).toBe(true)
  })
})

describe('PKCE', () => {
  it('requires it', () => {
    expect(checkAuthorization(request({ codeChallenge: '' }), CLIENT, RESOURCE)?.error).toBe(
      'pkce_required',
    )
  })

  it('refuses plain, which defends against nothing', () => {
    // `plain` puts the verifier in the same message as the challenge.
    expect(
      checkAuthorization(request({ codeChallengeMethod: 'plain' }), CLIENT, RESOURCE)?.error,
    ).toBe('pkce_method_unsupported')
  })

  it('matches a verifier against its own challenge', () => {
    const verifier = 'a'.repeat(64)
    expect(verifierMatches(verifier, challengeFor(verifier))).toBe(true)
  })

  it('refuses somebody else’s verifier', () => {
    expect(verifierMatches('b'.repeat(64), challengeFor('a'.repeat(64)))).toBe(false)
  })

  it('refuses a verifier too short to be worth guessing at', () => {
    // RFC 7636 wants 43–128 characters.
    const short = 'a'.repeat(20)
    expect(verifierMatches(short, challengeFor(short))).toBe(false)
  })
})

describe('what it will grant', () => {
  it('refuses a scope that is not on the list', () => {
    const refusal = checkAuthorization(request({ scope: ['ledger:post'] }), CLIENT, RESOURCE)

    expect(refusal?.error).toBe('invalid_scope')
    // Writing is reachable with a token somebody issued deliberately, not with
    // a browser click on a screen they skim-read.
    expect(refusal?.description).toContain('ledger:post')
  })

  it('accepts the read scopes', () => {
    expect(
      checkAuthorization(request({ scope: ['ledger:read', 'ledger:export'] }), CLIENT, RESOURCE),
    ).toBeNull()
  })
})

describe('audience binding', () => {
  it('refuses a token request aimed at another instance', () => {
    // RFC 8707, and the confused deputy the MCP authorization spec warns about:
    // a token minted here must not be replayable somewhere else.
    const refusal = checkAuthorization(
      request({ resource: 'https://someone-else.example/api/mcp' }),
      CLIENT,
      RESOURCE,
    )

    expect(refusal?.error).toBe('resource_mismatch')
  })

  it('tolerates a client that does not send one', () => {
    expect(checkAuthorization(request({ resource: null }), CLIENT, RESOURCE)).toBeNull()
  })

  it('ignores a trailing slash', () => {
    expect(sameResource(`${RESOURCE}/`, RESOURCE)).toBe(true)
  })
})

describe('redeeming a code', () => {
  const NOW = new Date('2026-09-10T12:00:00Z')
  const verifier = 'v'.repeat(64)

  const stored = (overrides: Partial<StoredCode> = {}): StoredCode => ({
    clientId: CLIENT.clientId,
    redirectUri: CLIENT.redirectUris[0]!,
    codeChallenge: challengeFor(verifier),
    resource: RESOURCE,
    scope: ['ledger:read'],
    userId: 'user-1',
    entityId: 'entity-1',
    expiresAt: '2026-09-10T12:00:30.000Z',
    consumedAt: null,
    ...overrides,
  })

  const redemption = {
    grantType: 'authorization_code',
    code: 'the-code',
    clientId: CLIENT.clientId,
    redirectUri: CLIENT.redirectUris[0]!,
    codeVerifier: verifier,
    resource: RESOURCE,
  }

  it('accepts a good one', () => {
    expect(checkRedemption(redemption, stored(), NOW, RESOURCE)).toBeNull()
  })

  it('tells a replay apart from an unknown code', () => {
    /**
     * Not pedantry. A code redeemed twice is a code that leaked, and the
     * response to that is to revoke what it produced — which cannot happen if
     * it looks the same as a typo.
     */
    expect(checkRedemption(redemption, null, NOW, RESOURCE)?.error).toBe('unknown_code')
    expect(
      checkRedemption(redemption, stored({ consumedAt: '2026-09-10T11:59:00Z' }), NOW, RESOURCE)
        ?.error,
    ).toBe('code_already_used')
  })

  it('expires', () => {
    const later = new Date('2026-09-10T12:01:00Z')
    expect(checkRedemption(redemption, stored(), later, RESOURCE)?.error).toBe('code_expired')
  })

  it('refuses a different client spending it', () => {
    expect(
      checkRedemption({ ...redemption, clientId: 'klopt_c_other' }, stored(), NOW, RESOURCE)?.error,
    ).toBe('client_mismatch')
  })

  it('refuses a redirect that is not the one it was issued for', () => {
    expect(
      checkRedemption(
        { ...redemption, redirectUri: 'http://127.0.0.1:9876/other' },
        stored(),
        NOW,
        RESOURCE,
      )?.error,
    ).toBe('redirect_uri_mismatch')
  })

  it('refuses the wrong verifier', () => {
    expect(
      checkRedemption({ ...redemption, codeVerifier: 'w'.repeat(64) }, stored(), NOW, RESOURCE)
        ?.error,
    ).toBe('pkce_failed')
  })

  it('refuses any grant type but authorization_code', () => {
    // No implicit, no password, no client credentials.
    for (const grantType of ['implicit', 'password', 'client_credentials', 'refresh_token']) {
      expect(checkRedemption({ ...redemption, grantType }, stored(), NOW, RESOURCE)?.error).toBe(
        'unsupported_grant_type',
      )
    }
  })
})
