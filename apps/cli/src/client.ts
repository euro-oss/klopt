import { randomUUID } from 'node:crypto'

/**
 * The one way this CLI reaches Klopt: an HTTP call to the public API.
 *
 * Spec 10.1: "The UI, the MCP server and the CLI are all clients. None of them
 * has a privileged path into the domain." So there is no database handle here
 * and no `@klopt/db` import — the lint config forbids it — and every command is
 * written against the same routes a script would call.
 *
 * That is not tidiness. A second path in would be a second place permissions
 * are checked and a second place the audit log is written, and the one that
 * gets forgotten is the one somebody uses at 23:00 when something is wrong.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly violations: readonly { path: string | null; message: string }[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface Credentials {
  readonly url: string
  /** A scoped API token, or a session cookie from `klopt login`. */
  readonly token?: string | undefined
  readonly cookie?: string | undefined
}

export type Fetch = typeof globalThis.fetch

export interface Client {
  get(path: string, query?: Record<string, string | undefined>): Promise<unknown>
  /** The raw body, for the exports that are a file rather than JSON. */
  getText(path: string, query?: Record<string, string | undefined>): Promise<string>
  post(path: string, body: unknown): Promise<unknown>
}

export function createClient(credentials: Credentials, doFetch: Fetch = globalThis.fetch): Client {
  const headers = (): Record<string, string> => {
    const result: Record<string, string> = { accept: 'application/json' }
    if (credentials.token !== undefined) result['authorization'] = `Bearer ${credentials.token}`
    if (credentials.cookie !== undefined) result['cookie'] = credentials.cookie
    return result
  }

  const url = (path: string, query?: Record<string, string | undefined>): string => {
    const target = new URL(`/api/v1${path}`, credentials.url)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) target.searchParams.set(key, value)
    }
    return target.toString()
  }

  /**
   * Turn a refusal into something an operator can act on.
   *
   * The API answers with a problem document: a machine-readable code, a
   * sentence, and the field at fault. Printing "Request failed with status
   * 422" would throw all of that away, and 422 is the status you get when the
   * thing you typed was nearly right.
   */
  const refuse = async (response: Response): Promise<never> => {
    let detail = `${String(response.status)} ${response.statusText}`
    let code: string | null = null
    let violations: { path: string | null; message: string }[] = []

    try {
      const problem = (await response.json()) as {
        detail?: string
        code?: string
        violations?: { path: string | null; message: string }[]
      }
      if (typeof problem.detail === 'string') detail = problem.detail
      if (typeof problem.code === 'string') code = problem.code
      if (Array.isArray(problem.violations)) violations = problem.violations
    } catch {
      // Not a problem document. The status line is all there is.
    }

    throw new ApiError(detail, response.status, code, violations)
  }

  return {
    async get(path, query) {
      const response = await doFetch(url(path, query), { headers: headers() })
      if (!response.ok) await refuse(response)
      return response.json()
    },

    async getText(path, query) {
      const response = await doFetch(url(path, query), { headers: headers() })
      if (!response.ok) await refuse(response)
      return response.text()
    },

    async post(path, body) {
      const response = await doFetch(url(path), {
        method: 'POST',
        headers: {
          ...headers(),
          'content-type': 'application/json',
          // Every write takes one, and the CLI is the client most likely to be
          // run twice by somebody who was not sure the first one worked.
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify(body),
      })
      if (!response.ok) await refuse(response)
      return response.json()
    },
  }
}
