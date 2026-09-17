import type { ExactApp, ExactTokens } from '@klopt/core'

/**
 * Exact Online's OAuth2, and the two things about it that break clients.
 *
 * Authorization code grant, which is ordinary. What is not ordinary:
 *
 * **The access token lasts ten minutes.** Not an hour. A long import refreshes
 * several times while it runs, so refreshing cannot be a thing that happens at
 * the start and is then assumed.
 *
 * **The refresh token is single-use and rotates.** Every refresh returns a new
 * refresh token and invalidates the one that bought it. Three consequences,
 * each of which is a real failure somebody has had:
 *
 *  - A client that does not persist the new token loses the connection at the
 *    *next* refresh, not this one, so the bug appears ten minutes after the
 *    code that caused it.
 *  - Two concurrent refreshes race, and the loser's token is dead. So there is
 *    exactly one refresh path here and the client serialises on it.
 *  - Persisting has to happen *before* the new access token is used, because a
 *    crash in between leaves the stored refresh token already spent. Hence
 *    `onTokens` being awaited rather than fired and forgotten.
 *
 * ## The endpoint depends on the country
 *
 * `start.exactonline.nl` for the Netherlands, `.be`, `.de`, `.fr`,
 * `.co.uk`, `.es` and `.com` elsewhere. Same API, different host, and a token
 * from one is not valid at another. Configurable, defaulting to NL because that
 * is what this system is for.
 */

export const EXACT_NL_BASE = 'https://start.exactonline.nl'

/** The hosts Exact runs. Named so a settings screen can offer them. */
export const EXACT_BASES: readonly { readonly base: string; readonly label: string }[] = [
  { base: 'https://start.exactonline.nl', label: 'Nederland' },
  { base: 'https://start.exactonline.be', label: 'België' },
  { base: 'https://start.exactonline.de', label: 'Duitsland' },
  { base: 'https://start.exactonline.fr', label: 'Frankrijk' },
  { base: 'https://start.exactonline.co.uk', label: 'Verenigd Koninkrijk' },
  { base: 'https://start.exactonline.es', label: 'Spanje' },
  { base: 'https://start.exactonline.com', label: 'Overig' },
]

export class ExactAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** True when re-authorising is the only way out — the refresh token is dead. */
    readonly reauthorise: boolean,
  ) {
    super(message)
    this.name = 'ExactAuthError'
  }
}

export interface ExactOAuthOptions {
  readonly base?: string
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
  readonly now?: () => Date
}

/**
 * Where to send somebody to say yes.
 *
 * `force_login=0` so an already-logged-in user is not made to type a password
 * again. `state` is required rather than optional: it is the only thing tying
 * the callback to the request that started it, and without it the callback
 * endpoint will accept a code somebody else obtained.
 */
export function authorizeUrl(app: ExactApp, state: string, base = EXACT_NL_BASE): string {
  const url = new URL('/api/oauth2/auth', base)
  url.searchParams.set('client_id', app.clientId)
  url.searchParams.set('redirect_uri', app.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('force_login', '0')
  url.searchParams.set('state', state)
  return url.toString()
}

interface TokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  token_type?: unknown
  error?: unknown
  error_description?: unknown
}

/**
 * `expires_in`, defensively.
 *
 * A string of seconds and a number of seconds are both accepted. Which one
 * Exact sends is not something this code can settle without a token in hand,
 * and getting it wrong in the number-only direction would mean treating every
 * token as already expired — so both, and a fallback for neither.
 *
 * The fallback is nine minutes rather than ten: short of the documented
 * lifetime, so a wrong guess refreshes early instead of failing late.
 */
const FALLBACK_LIFETIME_SECONDS = 540

function lifetimeOf(value: unknown): number {
  const seconds =
    typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(seconds) || seconds <= 0) return FALLBACK_LIFETIME_SECONDS
  // A minute of headroom, so a request started just under the wire does not
  // arrive just over it.
  return Math.max(60, seconds - 60)
}

async function postForm(
  base: string,
  body: URLSearchParams,
  options: ExactOAuthOptions,
): Promise<ExactTokens> {
  const doFetch = options.fetch ?? globalThis.fetch
  const now = options.now ?? (() => new Date())
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000)

  let response: Response
  try {
    response = await doFetch(new URL('/api/oauth2/token', base).toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
      signal: controller.signal,
    })
  } catch (error: unknown) {
    throw new ExactAuthError(
      `Exact Online is not reachable: ${error instanceof Error ? error.message : String(error)}`,
      'unreachable',
      false,
    )
  } finally {
    clearTimeout(timeout)
  }

  const text = await response.text()
  let parsed: TokenResponse
  try {
    parsed = JSON.parse(text) as TokenResponse
  } catch {
    throw new ExactAuthError(
      `Exact Online answered ${String(response.status)} with something that is not JSON.`,
      'malformed',
      false,
    )
  }

  if (typeof parsed.error === 'string') {
    const description =
      typeof parsed.error_description === 'string' ? parsed.error_description : parsed.error
    // `invalid_grant` on a refresh means the token has been spent or revoked,
    // and no amount of retrying fixes it. Anything else might be transient.
    throw new ExactAuthError(description, parsed.error, parsed.error === 'invalid_grant')
  }

  if (typeof parsed.access_token !== 'string' || typeof parsed.refresh_token !== 'string') {
    throw new ExactAuthError(
      `Exact Online answered ${String(response.status)} without a token pair.`,
      'malformed',
      false,
    )
  }

  const expiresAt = new Date(now().getTime() + lifetimeOf(parsed.expires_in) * 1000)

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: expiresAt.toISOString(),
  }
}

/** Trade the code from the callback for the first token pair. */
export async function exchangeCode(
  app: ExactApp,
  code: string,
  options: ExactOAuthOptions = {},
): Promise<ExactTokens> {
  return postForm(
    options.base ?? EXACT_NL_BASE,
    new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: app.clientId,
      client_secret: app.clientSecret,
      redirect_uri: app.redirectUri,
    }),
    options,
  )
}

/**
 * Spend the refresh token for a new pair.
 *
 * The old refresh token is dead the moment this returns, whether or not the
 * caller stores the new one. That is the whole hazard, and it is why the client
 * below never calls this without a persist step wired to it.
 */
export async function refreshTokens(
  app: Pick<ExactApp, 'clientId' | 'clientSecret'>,
  refreshToken: string,
  options: ExactOAuthOptions = {},
): Promise<ExactTokens> {
  return postForm(
    options.base ?? EXACT_NL_BASE,
    new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: app.clientId,
      client_secret: app.clientSecret,
    }),
    options,
  )
}

/** Whether a stored pair is still usable, with a minute of slack. */
export function tokensExpired(tokens: Pick<ExactTokens, 'expiresAt'>, at: Date): boolean {
  const expiresAt = Date.parse(tokens.expiresAt)
  if (Number.isNaN(expiresAt)) return true
  return expiresAt - at.getTime() <= 60_000
}
