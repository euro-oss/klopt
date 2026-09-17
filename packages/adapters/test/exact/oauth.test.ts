import { describe, expect, it, vi } from 'vitest'
import { authorizeUrl, exchangeCode, refreshTokens, tokensExpired } from '../../src/index.js'
import { ExactAuthError } from '../../src/exact/oauth.js'

/**
 * Exact Online's OAuth2, and the parts of it that lose connections.
 *
 * Nothing here reaches Exact. The one fact this file rests on was checked
 * against the real endpoint: `POST /api/oauth2/token` with a bad grant answers
 * `400 {"error":"invalid_request","error_description":"..."}`, which is the
 * shape the error handling below reads.
 */

const app = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://books.example.org/api/v1/exact/callback',
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('the authorize URL', () => {
  it('carries the state, because the callback has nothing else to check', () => {
    // Without it the callback endpoint will accept a code somebody else got.
    const url = new URL(authorizeUrl(app, 'state-token'))
    expect(url.searchParams.get('state')).toBe('state-token')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(app.redirectUri)
  })

  it('does not force a fresh login', () => {
    const url = new URL(authorizeUrl(app, 'state-token'))
    expect(url.searchParams.get('force_login')).toBe('0')
  })

  it('goes to the host it is told to, because a token is host-specific', () => {
    const url = new URL(authorizeUrl(app, 'state', 'https://start.exactonline.be'))
    expect(url.host).toBe('start.exactonline.be')
  })
})

describe('exchanging the code', () => {
  it('sends the form Exact expects and reads the pair back', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 600,
        token_type: 'bearer',
      }),
    )

    const tokens = await exchangeCode(app, 'the-code', {
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => new Date('2026-09-08T12:00:00Z'),
    })

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://start.exactonline.nl/api/oauth2/token')
    const sent = new URLSearchParams(init.body as string)
    expect(sent.get('grant_type')).toBe('authorization_code')
    expect(sent.get('code')).toBe('the-code')
    expect(sent.get('redirect_uri')).toBe(app.redirectUri)

    expect(tokens.accessToken).toBe('access-1')
    expect(tokens.refreshToken).toBe('refresh-1')
    // Ten minutes minus a minute of headroom, so a request started just under
    // the wire does not arrive just over it.
    expect(tokens.expiresAt).toBe('2026-09-08T12:09:00.000Z')
  })

  it('accepts expires_in as a string as well as a number', async () => {
    // Treating a string as unparseable would mark every token expired on
    // arrival, which is the expensive direction to be wrong in.
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: 'a', refresh_token: 'r', expires_in: '600' }))

    const tokens = await exchangeCode(app, 'code', {
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => new Date('2026-09-08T12:00:00Z'),
    })

    expect(tokens.expiresAt).toBe('2026-09-08T12:09:00.000Z')
  })

  it('falls back to nine minutes when there is no lifetime at all', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'a', refresh_token: 'r' }))

    const tokens = await exchangeCode(app, 'code', {
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => new Date('2026-09-08T12:00:00Z'),
    })

    expect(tokens.expiresAt).toBe('2026-09-08T12:09:00.000Z')
  })

  it('reports Exact’s own error text rather than a status code', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: 'invalid_request', error_description: 'Handle could not be extracted' },
          400,
        ),
      )

    await expect(
      exchangeCode(app, 'code', { fetch: fetch as unknown as typeof globalThis.fetch }),
    ).rejects.toThrow('Handle could not be extracted')
  })
})

describe('refreshing', () => {
  it('says when re-authorising is the only way out', async () => {
    // `invalid_grant` means the refresh token has been spent or revoked. No
    // amount of retrying fixes it, and a screen has to say so rather than
    // showing a spinner.
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: 'invalid_grant', error_description: 'Token is no longer valid' },
          400,
        ),
      )

    const failure = await refreshTokens(app, 'spent-token', {
      fetch: fetch as unknown as typeof globalThis.fetch,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ExactAuthError)
    expect((failure as ExactAuthError).reauthorise).toBe(true)
  })

  it('does not mark an unreachable Exact as needing re-authorisation', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'))

    const failure = await refreshTokens(app, 'token', {
      fetch: fetch as unknown as typeof globalThis.fetch,
    }).catch((error: unknown) => error)

    expect((failure as ExactAuthError).reauthorise).toBe(false)
    expect((failure as ExactAuthError).code).toBe('unreachable')
  })
})

describe('expiry', () => {
  const at = new Date('2026-09-08T12:00:00Z')

  it('counts a token expiring within the minute as expired', () => {
    // Refreshing thirty seconds early costs one request. Not refreshing costs
    // the request that was about to be made.
    expect(tokensExpired({ expiresAt: '2026-09-08T12:00:30Z' }, at)).toBe(true)
  })

  it('leaves a token with real life in it alone', () => {
    expect(tokensExpired({ expiresAt: '2026-09-08T12:05:00Z' }, at)).toBe(false)
  })

  it('treats an unparseable expiry as expired', () => {
    expect(tokensExpired({ expiresAt: 'never' }, at)).toBe(true)
  })
})
