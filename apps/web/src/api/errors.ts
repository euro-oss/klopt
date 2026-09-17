import { LedgerError } from '@klopt/core'

/**
 * Deterministic errors (spec 10.2): a stable machine-readable code, the field
 * at fault, and the rule that was violated. "400 Bad Request" is not an API.
 *
 * The wire shape is RFC 9457 problem details plus a `violations` array, because
 * a ledger rejection usually has more than one cause and an importer posting a
 * thousand entries should learn all of them in one round trip.
 */

/**
 * A violation, either from the domain (a `LedgerErrorCode`) or from schema
 * parsing at the boundary (`invalid_request`). `LedgerViolation` is assignable
 * to this, so a domain rejection keeps its specific code all the way out.
 */
export interface ApiViolation {
  readonly code: string
  readonly path: string | null
  readonly message: string
  /**
   * Which sentence this is (ADR 0046), for a client writing its own.
   *
   * `code` is what you branch on and is deliberately coarse — `invalid_tax_code`
   * covers sixteen faults. This names the sentence, `message` is it rendered in
   * English, and `detail` holds the values inside it. Null when the sentence
   * came from a finding that already had one; then `detail.code` is the finding's.
   */
  readonly messageKey?: string | null
  readonly detail?: Readonly<Record<string, string>>
}

export type ApiErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  /**
   * It was here and is deliberately not any more.
   *
   * Distinct from `not_found` because the difference is the whole point: a
   * document deleted after its bewaarplicht ran out has a hash, a date and a
   * reason on record, and 404 would make that indistinguishable from a lost
   * file. 410 is what HTTP has for exactly this.
   */
  | 'gone'
  | 'validation_failed'
  | 'idempotency_key_required'
  | 'conflict'
  /**
   * An `If-Match` that no longer matches (spec 10.2).
   *
   * Distinct from `conflict`, which is a retried idempotency key: this one
   * says somebody else changed the thing while you had it open, and the fix
   * is to read it again rather than to retry what you sent.
   */
  | 'precondition_failed'
  | 'internal_error'

/**
 * The status each code answers with. Exported because the OpenAPI generator
 * reads it: a document that listed a 409 the code cannot produce, or omitted a
 * 410 it can, would be a second source of truth for the same fact.
 */
export const STATUS: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  gone: 410,
  validation_failed: 422,
  idempotency_key_required: 400,
  conflict: 409,
  precondition_failed: 412,
  internal_error: 500,
}

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly violations: readonly ApiViolation[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
  }

  get status(): number {
    return STATUS[this.code]
  }
}

export interface ProblemDocument {
  readonly type: string
  readonly title: string
  readonly status: number
  readonly code: string
  readonly detail: string
  readonly requestId: string | null
  readonly violations: readonly ApiViolation[]
}

/**
 * A domain error carries the ledger's own codes, which are more specific than
 * anything HTTP has to say. Those are preserved verbatim in `violations`; the
 * outer `code` only says which category of thing went wrong.
 */
export function toProblem(error: unknown, requestId: string | null): ProblemDocument {
  if (error instanceof ApiError) {
    return {
      type: `https://klopt.dev/errors/${error.code}`,
      title: error.code,
      status: error.status,
      code: error.code,
      detail: error.message,
      requestId,
      violations: error.violations,
    }
  }

  if (error instanceof LedgerError) {
    return {
      type: 'https://klopt.dev/errors/validation_failed',
      title: 'validation_failed',
      status: 422,
      code: 'validation_failed',
      detail: error.message,
      requestId,
      violations: error.violations,
    }
  }

  return {
    type: 'https://klopt.dev/errors/internal_error',
    title: 'internal_error',
    status: 500,
    code: 'internal_error',
    // Never the underlying message: it can contain a connection string, a
    // query, or another entity's data.
    detail: 'The request could not be completed.',
    requestId,
    violations: [],
  }
}

export function problemResponse(error: unknown, requestId: string | null): Response {
  const problem = toProblem(error, requestId)
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: { 'content-type': 'application/problem+json' },
  })
}

/**
 * Refuses an edit whose `If-Match` no longer matches (spec 10.2).
 *
 * Silent when the caller sent no `If-Match`: the header is how a client opts
 * into optimistic concurrency, and requiring it would break every client that
 * exists — including, on the day it shipped, our own UI. A caller who does not
 * ask for the check keeps the last-write-wins they have now, and a caller who
 * does gets a 412 naming what to do about it.
 *
 * Weak comparison, per RFC 9110: `If-Match` is defined to use strong
 * comparison, but a proxy that re-tags a response as weak would otherwise make
 * every edit fail, and the tags here are content hashes either way.
 */
export function requireIfMatch(ifMatch: string | null, current: string): void {
  if (ifMatch === null) return

  const normalise = (tag: string) => tag.trim().replace(/^W\//, '')
  const offered = ifMatch.split(',').map(normalise)
  if (offered.includes('*') || offered.includes(normalise(current))) return

  throw new ApiError(
    'precondition_failed',
    'This has changed since you read it. Read it again and reapply your change — ' +
      'saving now would overwrite somebody else’s edit without either of you seeing it.',
    [{ code: 'stale_etag', path: null, message: `The current ETag is ${current}.` }],
  )
}
