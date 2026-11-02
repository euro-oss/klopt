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

/**
 * The leading `name: message` block of a V8 stack.
 *
 * Same steps as `Error.prototype.toString`. Node writes that string in
 * front of the frames. The message may be several lines, and a line of it
 * may begin with `    at `. An empty name is omitted; an empty message is
 * omitted. Anything that is not a string has no block we can remove.
 */
function stackMessageBlock(name: unknown, message: unknown): string {
  if (typeof name !== 'string' || typeof message !== 'string') return ''
  if (name === '') return message
  if (message === '') return name
  return `${name}: ${message}`
}

/**
 * A V8 call site, anchored at both ends.
 *
 * The line is `    at` plus an optional `async`, an optional function, and
 * a location: `(path:line:col)`, a bare `path:line:col`, `<anonymous>`, or
 * `native`. A line that only begins with four spaces and `at ` is not a
 * frame. An overwritten stack, a cause chain, or a message replaced after
 * the stack was read can put an IBAN, a name, or a connection string there.
 */
const V8_FRAME = /^ {4}at (?:async )?(?:.* \()?(?:[^\s()]+:\d+:\d+|<anonymous>|native)\)?$/

/**
 * Stack frames only.
 *
 * Strip the `name: message` block before keeping frames, so a message line
 * that itself starts with four spaces and `at ` is never logged. A driver
 * message can quote a row there: an IBAN, a name, a connection string.
 * What remains is kept only when it is a real V8 location. Lines that are
 * the message itself are dropped too, in case the block did not match.
 *
 * `stack` is not always a string. It may be missing, or an object. Then
 * there are no frames, and reading it must not throw. A thrown value that
 * is not an Error never reaches this function.
 */
function stackFrames(error: Error): string {
  try {
    const stack = error.stack
    if (typeof stack !== 'string') return '(no stack)'

    const name: unknown = error.name
    const message: unknown = error.message
    const block = stackMessageBlock(name, message)
    let trace = block.length > 0 && stack.startsWith(block) ? stack.slice(block.length) : stack
    if (typeof message === 'string' && message.length > 0) {
      const hidden = new Set(message.split('\n'))
      trace = trace
        .split('\n')
        .filter((line) => !hidden.has(line))
        .join('\n')
    }

    const frames = trace.split('\n').filter((line) => V8_FRAME.test(line))
    return frames.length === 0 ? '(no stack)' : frames.join('\n')
  } catch {
    return '(no stack)'
  }
}

/**
 * What may be written next to the request id.
 *
 * `name` is caller-controlled on a thrown value. An identifier is a class
 * of error. Anything else — an IBAN, a person, a connection string — is
 * logged as `Error`.
 */
const ERROR_NAME = /^[A-Za-z_$][\w$]{0,63}$/

function loggedErrorName(name: unknown): string {
  return typeof name === 'string' && ERROR_NAME.test(name) ? name : 'Error'
}

/**
 * An unknown failure is a 500 the caller cannot act on.
 *
 * The response stays generic. The process log gets the request id, the
 * error's name, and the stack frames. Never the message, and never a thrown
 * value that is not an Error — that value may be a request body.
 */
function logUnknownInternalError(error: unknown, requestId: string | null): void {
  const request = requestId ?? '(no request id)'
  if (error instanceof Error) {
    console.error('[api] internal_error', request, loggedErrorName(error.name), stackFrames(error))
    return
  }
  console.error('[api] internal_error', request, `(no stack, thrown ${typeof error})`)
}

export function problemResponse(error: unknown, requestId: string | null): Response {
  if (!(error instanceof ApiError) && !(error instanceof LedgerError)) {
    logUnknownInternalError(error, requestId)
  }
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
