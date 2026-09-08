import {
  DIVISION_SELECT,
  ME_SELECT,
  parseDivision,
  parseMe,
  type ExactApp,
  type ExactClient,
  type ExactDivision,
  type ExactPage,
  type ExactRequestLog,
  type ExactTokens,
  type ExactUser,
} from '@klopt/core'
import { EXACT_NL_BASE, ExactAuthError, refreshTokens, tokensExpired } from './oauth.js'

/**
 * Reading Exact Online over its REST API (spec 13, spec 8).
 *
 * ## The token is refreshed here, once, and written down before it is used
 *
 * `onTokens` is awaited before the new access token is used for anything. Exact
 * invalidates the old refresh token the instant it issues a new one, so a
 * process that dies between "got a new pair" and "stored it" has thrown the
 * connection away. Storing first costs one write and removes that window.
 *
 * The `refreshing` promise is the other half: several pages in flight all
 * noticing an expired token would each spend the refresh token, and only the
 * first would succeed. They wait on one refresh instead.
 *
 * ## Rate limits are Exact's, not ours to discover by being throttled
 *
 * Exact publishes the remaining budget on every response
 * (`X-RateLimit-Remaining` daily, `X-RateLimit-Minutely-Remaining` per minute)
 * along with the moment each window resets. A 429 is handled by waiting for the
 * reset the response names rather than by backing off blindly, and the minutely
 * budget is pre-emptively respected: getting throttled on a five-thousand-row
 * import wastes the whole minute, and the header said so in advance.
 *
 * ## Every request is recorded
 *
 * Spec 8, rule 3: "every adapter records every request and response". `log`
 * holds the method, path, status, duration and row count of everything asked,
 * and the import report shows it. Not the bodies — a division's chart of
 * accounts is not something to keep a second copy of in a log.
 */

export interface ExactClientOptions {
  readonly app: Pick<ExactApp, 'clientId' | 'clientSecret'>
  readonly tokens: ExactTokens
  /**
   * Called with every new pair, before it is used. Must persist.
   *
   * Not optional, and not defaulted to a no-op: a no-op default is a connection
   * that works today and is broken tomorrow, which is the worst shape a bug can
   * have.
   */
  readonly onTokens: (tokens: ExactTokens) => Promise<void>
  readonly base?: string
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
  readonly now?: () => Date
  /** Injected in tests so waiting for a rate-limit reset is instant. */
  readonly sleep?: (ms: number) => Promise<void>
  /** Stop asking after this many requests. A runaway import is a real risk. */
  readonly maxRequests?: number
}

export class ExactApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message)
    this.name = 'ExactApiError'
  }
}

/** What Exact says about the budget. Null where the header was absent. */
export interface ExactRateLimit {
  readonly dailyRemaining: number | null
  readonly dailyResetAt: string | null
  readonly minutelyRemaining: number | null
  readonly minutelyResetAt: string | null
}

const DEFAULT_MAX_REQUESTS = 2_000
/** Below this many calls left in the minute, wait for the window to turn over. */
const MINUTELY_FLOOR = 2

function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** Exact's reset headers are epoch milliseconds. */
function headerInstant(headers: Headers, name: string): string | null {
  const value = headerNumber(headers, name)
  if (value === null) return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

function rateLimitOf(headers: Headers): ExactRateLimit {
  return {
    dailyRemaining: headerNumber(headers, 'X-RateLimit-Remaining'),
    dailyResetAt: headerInstant(headers, 'X-RateLimit-Reset'),
    minutelyRemaining: headerNumber(headers, 'X-RateLimit-Minutely-Remaining'),
    minutelyResetAt: headerInstant(headers, 'X-RateLimit-Minutely-Reset'),
  }
}

/**
 * The rows out of a v1 response.
 *
 * Exact wraps collections as `{ d: { results: [...], __next: "..." } }` and
 * single entities as `{ d: { ... } }`, and some endpoints answer
 * `{ d: [...] }`. All three are shapes this has to accept, because which one a
 * resource uses is not something a caller can control.
 */
function unwrap(body: unknown): ExactPage<Record<string, unknown>> {
  if (typeof body !== 'object' || body === null || !('d' in body)) {
    return { rows: [], next: null }
  }

  const payload: unknown = body.d

  if (Array.isArray(payload)) {
    return { rows: payload as Record<string, unknown>[], next: null }
  }
  if (typeof payload !== 'object' || payload === null) {
    return { rows: [], next: null }
  }

  const wrapper = payload as { results?: unknown; __next?: unknown }
  if (Array.isArray(wrapper.results)) {
    return {
      rows: wrapper.results as Record<string, unknown>[],
      next: typeof wrapper.__next === 'string' ? wrapper.__next : null,
    }
  }

  // A single entity. One row, so callers do not need a second code path.
  return { rows: [payload as Record<string, unknown>], next: null }
}

export function createExactClient(options: ExactClientOptions): ExactClient & {
  readonly tokens: () => ExactTokens
  readonly rateLimit: () => ExactRateLimit | null
} {
  const base = options.base ?? EXACT_NL_BASE
  const doFetch = options.fetch ?? globalThis.fetch
  const now = options.now ?? (() => new Date())
  const sleep = options.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)))
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS

  let tokens = options.tokens
  let refreshing: Promise<void> | null = null
  let limit: ExactRateLimit | null = null
  let requests = 0
  const log: ExactRequestLog[] = []

  async function refresh(): Promise<void> {
    // One refresh at a time, whoever asks. A second caller waits for the first
    // rather than spending the token that is already in flight.
    refreshing ??= (async () => {
      const next = await refreshTokens(options.app, tokens.refreshToken, {
        base,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.now === undefined ? {} : { now: options.now }),
      })
      // Persisted before it is used. The old refresh token is already dead.
      await options.onTokens(next)
      tokens = next
    })().finally(() => {
      refreshing = null
    })

    await refreshing
  }

  /** Wait out a window Exact has told us about. */
  async function waitFor(resetAt: string | null, reason: string): Promise<void> {
    if (resetAt === null) {
      // No reset header to go on. A flat wait rather than a tight retry loop.
      await sleep(5_000)
      return
    }
    const ms = Date.parse(resetAt) - now().getTime()
    if (ms <= 0) return
    if (ms > 15 * 60_000) {
      throw new ExactApiError(
        `Exact's ${reason} limit resets at ${resetAt}, which is too far off to wait for.`,
        429,
        reason,
      )
    }
    // A second of slack, because the reset instant and our clock are not the
    // same clock.
    await sleep(ms + 1_000)
  }

  async function request(url: string, path: string): Promise<ExactPage<Record<string, unknown>>> {
    if (requests >= maxRequests) {
      throw new ExactApiError(
        `This import has already made ${String(requests)} requests to Exact. Stopping rather than continuing indefinitely.`,
        0,
        path,
      )
    }

    if (tokensExpired(tokens, now())) await refresh()

    // Pre-emptive: the previous response said how much of the minute is left.
    if (
      limit !== null &&
      limit.minutelyRemaining !== null &&
      limit.minutelyRemaining <= MINUTELY_FLOOR
    ) {
      await waitFor(limit.minutelyResetAt, 'per-minute')
    }

    return attempt(url, path, false)
  }

  async function attempt(
    url: string,
    path: string,
    retried: boolean,
  ): Promise<ExactPage<Record<string, unknown>>> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
    const startedAt = now().getTime()
    requests += 1

    let response: Response
    try {
      response = await doFetch(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${tokens.accessToken}`,
          accept: 'application/json',
        },
        signal: controller.signal,
      })
    } catch (error: unknown) {
      throw new ExactApiError(
        `Exact Online is not reachable: ${error instanceof Error ? error.message : String(error)}`,
        0,
        path,
      )
    } finally {
      clearTimeout(timeout)
    }

    limit = rateLimitOf(response.headers)
    const text = await response.text()

    if (response.status === 401 && !retried) {
      // The token expired sooner than its own `expires_in` said, which happens
      // when somebody revokes the app. One refresh, one retry, then give up.
      await refresh()
      return attempt(url, path, true)
    }

    if (response.status === 429 && !retried) {
      await waitFor(limit.minutelyResetAt ?? limit.dailyResetAt, 'rate')
      return attempt(url, path, true)
    }

    if (!response.ok) {
      log.push({
        method: 'GET',
        path,
        status: response.status,
        durationMs: now().getTime() - startedAt,
        rows: 0,
      })
      throw new ExactApiError(
        // Exact's errors are `{"error":{"message":{"value":"..."}}}`. The text
        // is kept whole rather than dug into, because the shape varies and a
        // truncated message is worse than a raw one.
        `Exact Online answered ${String(response.status)} for ${path}: ${text.slice(0, 400)}`,
        response.status,
        path,
      )
    }

    let page: ExactPage<Record<string, unknown>>
    try {
      page = unwrap(JSON.parse(text))
    } catch {
      throw new ExactApiError(
        `Exact Online answered ${path} with something that is not JSON.`,
        response.status,
        path,
      )
    }

    log.push({
      method: 'GET',
      path,
      status: response.status,
      durationMs: now().getTime() - startedAt,
      rows: page.rows.length,
    })

    return page
  }

  function urlFor(request: {
    readonly division: number
    readonly path: string
    readonly select: readonly string[]
    readonly filter?: string
    readonly orderBy?: string
    readonly top?: number
  }): string {
    const url = new URL(`/api/v1/${String(request.division)}/${request.path}`, base)
    url.searchParams.set('$select', request.select.join(','))
    if (request.filter !== undefined) url.searchParams.set('$filter', request.filter)
    if (request.orderBy !== undefined) url.searchParams.set('$orderby', request.orderBy)
    if (request.top !== undefined) url.searchParams.set('$top', String(request.top))
    return url.toString()
  }

  const client: ExactClient & {
    readonly tokens: () => ExactTokens
    readonly rateLimit: () => ExactRateLimit | null
  } = {
    get log() {
      return log
    },

    tokens: () => tokens,
    rateLimit: () => limit,

    async me(): Promise<ExactUser> {
      // `current/Me` rather than a division: it is the one endpoint that works
      // before anybody has chosen one, and its answer includes which division
      // Exact would otherwise have used.
      const url = new URL('/api/v1/current/Me', base)
      url.searchParams.set('$select', ME_SELECT.join(','))
      const page = await request(url.toString(), 'current/Me')
      const [row] = page.rows
      if (row === undefined) {
        throw new ExactApiError('Exact Online returned no user for this token.', 200, 'current/Me')
      }
      return parseMe(row)
    },

    async divisions(): Promise<readonly ExactDivision[]> {
      // Division-scoped, and the division has to be one this token can reach —
      // so the current one, which `me()` just told us. The *answer* is every
      // division, which is the point.
      const user = await this.me()
      const rows: Record<string, unknown>[] = []
      let url: string | null = urlFor({
        division: user.currentDivision,
        path: 'system/Divisions',
        select: [...DIVISION_SELECT],
      })

      while (url !== null) {
        const page: ExactPage<Record<string, unknown>> = await request(url, 'system/Divisions')
        rows.push(...page.rows)
        url = page.next
      }

      return rows.map(parseDivision)
    },

    async page(query): Promise<ExactPage<Record<string, unknown>>> {
      return request(urlFor(query), query.path)
    },

    async nextPage(url): Promise<ExactPage<Record<string, unknown>>> {
      // `__next` is absolute and already carries the query. Its path is used
      // for the log so the pages of one resource group together.
      const path = new URL(url).pathname.split('/').slice(4).join('/')
      return request(url, path === '' ? 'next' : path)
    },

    async download(url): Promise<Uint8Array> {
      if (tokensExpired(tokens, now())) await refresh()

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
      const startedAt = now().getTime()
      requests += 1

      try {
        const response = await doFetch(url, {
          method: 'GET',
          headers: { authorization: `Bearer ${tokens.accessToken}` },
          signal: controller.signal,
        })
        limit = rateLimitOf(response.headers)

        if (!response.ok) {
          throw new ExactApiError(
            `Exact Online answered ${String(response.status)} for an attachment.`,
            response.status,
            'attachment',
          )
        }

        const bytes = new Uint8Array(await response.arrayBuffer())
        log.push({
          method: 'GET',
          path: 'attachment',
          status: response.status,
          durationMs: now().getTime() - startedAt,
          rows: 1,
        })
        return bytes
      } catch (error: unknown) {
        if (error instanceof ExactApiError) throw error
        throw new ExactApiError(
          `An attachment could not be downloaded: ${error instanceof Error ? error.message : String(error)}`,
          0,
          'attachment',
        )
      } finally {
        clearTimeout(timeout)
      }
    },
  }

  return client
}

/**
 * Every page of one resource, as one array.
 *
 * Paged rather than `$top`-ed to a large number, because Exact caps page size
 * server-side and silently returns fewer rows than asked for — a client that
 * trusted `$top` would import part of a chart of accounts and report success.
 */
export async function collectAll(
  client: ExactClient,
  query: {
    readonly division: number
    readonly path: string
    readonly select: readonly string[]
    readonly filter?: string
    readonly orderBy?: string
  },
): Promise<readonly Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let page = await client.page(query)
  rows.push(...page.rows)

  while (page.next !== null) {
    page = await client.nextPage(page.next)
    rows.push(...page.rows)
  }

  return rows
}

export { ExactAuthError }
