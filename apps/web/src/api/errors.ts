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
 * Read one own property. A getter may throw; the 500 handler must not.
 */
function readOwn(value: object, key: 'name' | 'message' | 'stack' | 'cause'): unknown {
  try {
    if (key === 'name') return (value as { name?: unknown }).name
    if (key === 'message') return (value as { message?: unknown }).message
    if (key === 'stack') return (value as { stack?: unknown }).stack
    return (value as { cause?: unknown }).cause
  } catch {
    return undefined
  }
}

/**
 * The location half of a V8 frame, or null when the line is not one.
 *
 * Only the location is kept, never the function name. Allowed shapes are
 * `native`, `<anonymous>`, or `path:line:col` where `path` is a file URL,
 * an http(s) URL without userinfo, a `node:` path, or a filesystem path
 * (contains `/`, `\`, or a file extension). Query strings are stripped from
 * URLs. A bare token ending in `:line:col` is not a path.
 */
function frameLocation(line: string): string | null {
  if (!line.startsWith('    at ')) return null
  let rest = line.slice('    at '.length)
  if (rest.startsWith('async ')) rest = rest.slice('async '.length)
  const wrappedAt = rest.lastIndexOf(' (')
  const location = wrappedAt !== -1 && rest.endsWith(')') ? rest.slice(wrappedAt + 2, -1) : rest
  if (location === 'native' || location === '<anonymous>') return location

  const parsed = parseFramePathLineCol(location)
  if (parsed === null) return null
  const path = stripUrlQuery(parsed.path)
  if (path.includes('@') || urlLocationHasUserinfo(path)) return null
  if (!allowedFramePath(path)) return null
  return `${path}:${parsed.line}:${parsed.col}`
}

function parseFramePathLineCol(
  location: string,
): { path: string; line: string; col: string } | null {
  const colSep = location.lastIndexOf(':')
  if (colSep <= 0) return null
  const col = location.slice(colSep + 1)
  const beforeCol = location.slice(0, colSep)
  const lineSep = beforeCol.lastIndexOf(':')
  if (lineSep <= 0) return null
  const line = beforeCol.slice(lineSep + 1)
  const path = beforeCol.slice(0, lineSep)
  if (!/^\d+$/.test(line) || !/^\d+$/.test(col)) return null
  return { path, line, col }
}

function stripUrlQuery(path: string): string {
  const lower = path.toLowerCase()
  if (
    !lower.startsWith('http://') &&
    !lower.startsWith('https://') &&
    !lower.startsWith('file://')
  ) {
    return path
  }
  const q = path.indexOf('?')
  const h = path.indexOf('#')
  let end = path.length
  if (q !== -1 && q < end) end = q
  if (h !== -1 && h < end) end = h
  return path.slice(0, end)
}

function urlLocationHasUserinfo(path: string): boolean {
  const scheme = path.indexOf('://')
  if (scheme === -1) return false
  const after = path.slice(scheme + 3)
  const at = after.indexOf('@')
  if (at === -1) return false
  return after.slice(0, at).includes(':')
}

function allowedFramePath(path: string): boolean {
  const lower = path.toLowerCase()
  if (lower.startsWith('file://')) return true
  if (lower.startsWith('node:')) return true
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return !path.includes('@')
  }
  if (path.includes('/') || path.includes('\\')) return true
  if (/\.[a-z0-9]+$/i.test(path)) return true
  return false
}

/**
 * Locations from one stack string.
 *
 * The leading `name: message` block is removed first, including when the
 * message is several lines. Lines that are the message itself are dropped
 * too, for a stack that was overwritten or whose message was replaced after
 * the stack was read.
 */
function locationsFromStack(stack: string, name: unknown, message: unknown): string[] {
  const block = stackMessageBlock(name, message)
  let trace = block.length > 0 && stack.startsWith(block) ? stack.slice(block.length) : stack
  if (typeof message === 'string' && message.length > 0) {
    const hidden = new Set(message.split('\n'))
    trace = trace
      .split('\n')
      .filter((line) => !hidden.has(line))
      .join('\n')
  }
  const locations: string[] = []
  for (const line of trace.split('\n')) {
    const location = frameLocation(line)
    if (location !== null) locations.push(`    at ${location}`)
  }
  return locations
}

/**
 * Locations from a cause chain. The cause message is not logged. A throwing
 * getter, or a cycle, stops the walk.
 */
function causeLocations(cause: unknown, seen: Set<object>): string[] {
  if (typeof cause !== 'object' || cause === null || seen.has(cause)) return []
  if (seen.size > 8) return []
  seen.add(cause)
  const stack = readOwn(cause, 'stack')
  const name = readOwn(cause, 'name')
  const message = readOwn(cause, 'message')
  const next = readOwn(cause, 'cause')
  const own = typeof stack === 'string' ? locationsFromStack(stack, name, message) : []
  return [...own, ...causeLocations(next, seen)]
}

/**
 * Stack locations only.
 *
 * `stack` is not always a string. It may be missing, or an object. Then
 * there are no frames. A thrown value that is not an Error never reaches
 * this function.
 */
function stackFrames(error: Error): string {
  const stack = readOwn(error, 'stack')
  const name = readOwn(error, 'name')
  const message = readOwn(error, 'message')
  const cause = readOwn(error, 'cause')
  if (typeof stack !== 'string') return '(no stack)'
  const lines = [
    ...locationsFromStack(stack, name, message),
    ...causeLocations(cause, new Set<object>([error])),
  ]
  return lines.length === 0 ? '(no stack)' : lines.join('\n')
}

/**
 * What may be written next to the request id.
 *
 * Only a class-shaped name ending in `Error` or `Exception`. Anything else
 * is logged as `Error`.
 */
const ERROR_NAME = /^[A-Z][A-Za-z0-9]*(Error|Exception)$/

function loggedErrorName(name: unknown): string {
  return typeof name === 'string' && ERROR_NAME.test(name) ? name : 'Error'
}

/**
 * IBAN-shaped substring, case and separators ignored. Linear scan, no
 * word boundaries. Used on the error name, message, and every log string.
 */
export function redactIbansInLog(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const end = ibanSpanEnd(text, i)
    if (end !== null) {
      out += '[iban]'
      i = end
      continue
    }
    out += text[i]
    i++
  }
  return out
}

function ibanSpanEnd(text: string, start: number): number | null {
  if (start + 4 > text.length) return null
  if (!isAsciiLetter(text[start]!) || !isAsciiLetter(text[start + 1]!)) return null
  if (!isDigit(text[start + 2]!) || !isDigit(text[start + 3]!)) return null

  let pos = start + 4
  let compact = 4
  while (pos < text.length && compact < 34) {
    const ch = text[pos]!
    if (ch === ' ' || ch === '\t') {
      pos++
      continue
    }
    if (!isAsciiLetter(ch) && !isDigit(ch)) break
    compact++
    pos++
  }
  if (compact < 15) return null

  let body = ''
  for (let p = start; p < pos; p++) {
    const ch = text[p]!
    if (ch === ' ' || ch === '\t') continue
    body += ch.toUpperCase()
  }
  if (body.length < 15 || body.length > 34) return null
  if (body[0]! < 'A' || body[0]! > 'Z' || body[1]! < 'A' || body[1]! > 'Z') return null
  if (!isDigit(body[2]!) || !isDigit(body[3]!)) return null
  for (let k = 4; k < body.length; k++) {
    const ch = body[k]!
    if (ch < '0' || (ch > '9' && ch < 'A') || ch > 'Z') return null
  }
  return pos
}

function isAsciiLetter(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

/**
 * An unknown failure is a 500 the caller cannot act on.
 *
 * The response stays generic. The process log gets the request id, the
 * error's name, and the stack frames. Never the message, and never a thrown
 * value that is not an Error — that value may be a request body.
 */
function logUnknownInternalError(error: unknown, requestId: string | null): void {
  const request = redactIbansInLog(requestId ?? '(no request id)')
  if (!(error instanceof Error)) {
    console.error('[api] internal_error', request, `(no stack, thrown ${typeof error})`)
    return
  }
  let name: string
  let frames: string
  try {
    const rawName = readOwn(error, 'name')
    const rawMessage = readOwn(error, 'message')
    const nameInput = typeof rawName === 'string' ? rawName : ''
    const messageInput = typeof rawMessage === 'string' ? rawMessage : ''
    // Message is not logged; the same backstop still runs on it.
    void redactIbansInLog(messageInput)
    name = redactIbansInLog(loggedErrorName(redactIbansInLog(nameInput)))
    frames = redactIbansInLog(stackFrames(error))
  } catch {
    name = 'Error'
    frames = '(no stack)'
  }
  console.error('[api] internal_error', request, name, frames)
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
