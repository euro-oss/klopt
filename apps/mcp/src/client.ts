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

  /**
   * A GET against `/api/v1`.
   *
   * Only GET, and deliberately: this server has no write tools yet, so a POST
   * helper would exist only to make one easy to add without first thinking
   * about the proposal model (spec 10.3).
   */
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

  private async request(path: string): Promise<string> {
    const url = `${this.base}/api/v1${path}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    let response: Response
    try {
      response = await this.doFetch(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${this.options.token}`,
          accept: 'application/json',
        },
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
