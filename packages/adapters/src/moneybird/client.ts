import {
  parseAdministration,
  type MoneybirdAdministration,
  type MoneybirdClient,
  type MoneybirdPage,
  type MoneybirdRequestLog,
} from '@klopt/core'

/**
 * Reading Moneybird over REST API v2 with a personal API token.
 *
 * OAuth is out of scope. The token is supplied already decrypted; storing it
 * encrypted is the repository's job, the same way a mailbox password is.
 *
 * Every request is recorded (spec 8). Bodies are not: an administration's
 * invoices are not a second copy to keep in a log.
 */

export const MONEYBIRD_API_BASE = 'https://moneybird.com/api/v2'

export interface MoneybirdClientOptions {
  readonly token: string
  readonly base?: string
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly maxRequests?: number
}

export class MoneybirdApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message)
    this.name = 'MoneybirdApiError'
  }
}

const DEFAULT_MAX_REQUESTS = 4_000
const DEFAULT_PER_PAGE = 100

export function createMoneybirdClient(options: MoneybirdClientOptions): MoneybirdClient {
  const base = (options.base ?? MONEYBIRD_API_BASE).replace(/\/$/, '')
  const doFetch = options.fetch ?? globalThis.fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)))
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS
  const timeoutMs = options.timeoutMs ?? 30_000

  let requests = 0
  const log: MoneybirdRequestLog[] = []

  async function ask(path: string): Promise<{ status: number; body: unknown; durationMs: number }> {
    requests += 1
    if (requests > maxRequests) {
      throw new MoneybirdApiError(
        `Stopped after ${String(maxRequests)} Moneybird requests to avoid a runaway import.`,
        0,
        path,
      )
    }

    const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`
    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await doFetch(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${options.token}`,
          accept: 'application/json',
        },
        signal: controller.signal,
      })
    } catch (error: unknown) {
      const durationMs = Date.now() - started
      log.push({ method: 'GET', path, status: 0, durationMs, rows: 0 })
      const message = error instanceof Error ? error.message : String(error)
      throw new MoneybirdApiError(`Moneybird could not be reached: ${message}`, 0, path)
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? '2')
      const waitMs = Number.isFinite(retryAfter) ? Math.min(retryAfter, 60) * 1000 : 2_000
      await sleep(waitMs)
      return ask(path)
    }

    const text = await response.text()
    const durationMs = Date.now() - started
    let body: unknown = text
    try {
      body = text === '' ? null : JSON.parse(text)
    } catch {
      body = text
    }

    const rows = Array.isArray(body) ? body.length : body === null ? 0 : 1
    log.push({ method: 'GET', path, status: response.status, durationMs, rows })

    if (response.status === 401 || response.status === 403) {
      throw new MoneybirdApiError(
        `Moneybird refused this token (${String(response.status)}).`,
        response.status,
        path,
      )
    }
    if (!response.ok) {
      throw new MoneybirdApiError(
        `Moneybird answered ${String(response.status)} for ${path}.`,
        response.status,
        path,
      )
    }

    return { status: response.status, body, durationMs }
  }

  return {
    async administrations(): Promise<readonly MoneybirdAdministration[]> {
      const { body } = await ask('/administrations.json')
      if (!Array.isArray(body)) return []
      return body
        .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
        .map(parseAdministration)
    },

    async page(request): Promise<MoneybirdPage<Record<string, unknown>>> {
      const page = request.page ?? 1
      const perPage = request.perPage ?? DEFAULT_PER_PAGE
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        ...request.query,
      })
      const path = `/${request.administrationId}/${request.path}?${params.toString()}`
      const { body } = await ask(path)
      const rows = Array.isArray(body)
        ? body.filter(
            (row): row is Record<string, unknown> => typeof row === 'object' && row !== null,
          )
        : []
      return { rows, page, perPage, maybeMore: rows.length >= perPage }
    },

    async download(url: string): Promise<Uint8Array> {
      requests += 1
      if (requests > maxRequests) {
        throw new MoneybirdApiError(
          `Stopped after ${String(maxRequests)} Moneybird requests to avoid a runaway import.`,
          0,
          url,
        )
      }
      const started = Date.now()
      const response = await doFetch(url, {
        headers: { authorization: `Bearer ${options.token}` },
      })
      const bytes = new Uint8Array(await response.arrayBuffer())
      log.push({
        method: 'GET',
        path: url,
        status: response.status,
        durationMs: Date.now() - started,
        rows: 0,
      })
      if (!response.ok) {
        throw new MoneybirdApiError(
          `Moneybird would not download an attachment (${String(response.status)}).`,
          response.status,
          url,
        )
      }
      return bytes
    },

    get log() {
      return log
    },
  }
}

export async function collectAll(
  client: MoneybirdClient,
  request: {
    readonly administrationId: string
    readonly path: string
    readonly query?: Readonly<Record<string, string>>
  },
): Promise<readonly Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let page = 1
  for (;;) {
    const result = await client.page({ ...request, page, perPage: 100 })
    rows.push(...result.rows)
    if (!result.maybeMore) return rows
    page += 1
  }
}
