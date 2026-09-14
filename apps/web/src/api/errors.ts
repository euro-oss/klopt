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
