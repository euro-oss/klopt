import { randomUUID } from 'node:crypto'
/**
 * The one way this server reaches Klopt: an HTTP call to the public API.
 *
 * Spec 10.3's architectural rule, and the reason this file exists at all:
 * "the MCP server is a client of the public API, not a privileged path.
 * Anything an agent can do, a script can do, under one permission model and
 * one audit trail."
 *
 * That is not a style preference. A second path into the domain would be a
 * second place for permissions to be checked and a second place for the audit
 * log to be written, and the one that gets forgotten is the one an agent uses.
 * So there is no database handle here and no `@klopt/db` import — the lint
 * config forbids it — and every tool below is written against the same routes
 * a script would call.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly path: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiClientOptions {
  /** Where Klopt is, e.g. `https://books.example.org`. */
  readonly baseUrl: string
  /** A scoped token. Its permissions are the agent's permissions. */
  readonly token: string
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
}

/** RFC 9457, which is what the API answers errors in. */
interface Problem {
  readonly code?: unknown
  readonly detail?: unknown
  readonly title?: unknown
}

export class ApiClient {
  private readonly base: string
  private readonly doFetch: typeof globalThis.fetch
  private readonly timeoutMs: number

  constructor(private readonly options: ApiClientOptions) {
    this.base = options.baseUrl.replace(/\/+$/, '')
    this.doFetch = options.fetch ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  /** A GET against `/api/v1`. */
  async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) search.set(key, String(value))
    }
    const suffix = search.size === 0 ? '' : `${path.includes('?') ? '&' : '?'}${search.toString()}`
    return JSON.parse(await this.request(`${path}${suffix}`)) as T
  }

  /**
   * The same request, for a route that answers with something other than JSON.
   *
   * The auditfile export returns XML. Parsing that as JSON to satisfy one type
   * signature would fail on the one route that most needs to work.
   */
  async getText(path: string): Promise<string> {
    return this.request(path)
  }

  /**
   * A POST against `/api/v1`, for the proposal tools (spec 10.3).
   *
   * Every caller of this creates something a human still has to release — a
   * draft invoice, a captured purchase, a validated entry that was not posted.
   * Nothing here issues, books or sends, because those are the release, and
   * the release is the human's.
   *
   * The idempotency key is generated per call rather than taken as an
   * argument. An agent retrying a tool it thinks failed is the ordinary case,
   * and a key it chose could be reused across two genuinely different drafts.
   */
  async post<T>(path: string, body: unknown): Promise<T> {
    return JSON.parse(await this.request(path, { method: 'POST', body })) as T
  }

  private async request(
    path: string,
    options: { readonly method?: string; readonly body?: unknown } = {},
  ): Promise<string> {
    const url = `${this.base}/api/v1${path}`
    const method = options.method ?? 'GET'

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    let response: Response
    try {
      response = await this.doFetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.options.token}`,
          accept: 'application/json',
          ...(options.body === undefined
            ? {}
            : { 'content-type': 'application/json', 'idempotency-key': randomUUID() }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      })
    } catch (error: unknown) {
      throw new ApiError(
        `Klopt is not reachable at ${this.base}: ${error instanceof Error ? error.message : String(error)}`,
        0,
        null,
        path,
      )
    } finally {
      clearTimeout(timeout)
    }

    const text = await response.text()

    if (!response.ok) {
      // The API's errors are deterministic and carry the rule that was violated
      // (spec 10.2). Passing that through beats replacing it with "the request
      // failed", which is then what the agent has to guess about.
      let problem: Problem = {}
      try {
        problem = JSON.parse(text) as Problem
      } catch {
        /* Not JSON. The status and the body are all there is. */
      }
      const detail = typeof problem.detail === 'string' ? problem.detail : text.slice(0, 300)
      const code = typeof problem.code === 'string' ? problem.code : null
      throw new ApiError(detail, response.status, code, path)
    }

    return text
  }
}
