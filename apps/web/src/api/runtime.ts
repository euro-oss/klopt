import type { z } from 'zod'
import { resolveRequestContext, resolveSetupContext } from './auth.js'
import { getDatabase } from './database.js'
import { ApiError, problemResponse } from './errors.js'
import type { RequestContext, SetupContext } from './context.js'

/**
 * The glue between a `Request` and a handler.
 *
 * Route files stay thin on purpose: parse, call a handler, serialise. Anything
 * more than that belongs in the handler, and anything resembling a rule belongs
 * in @klopt/core.
 */

export async function handle(
  request: Request,
  work: (context: RequestContext) => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  let requestId: string | null = request.headers.get('x-request-id')

  try {
    const context = await resolveRequestContext({ database: getDatabase(), request })
    requestId = context.requestId

    const result = await work(context)
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: {
        'content-type': 'application/json',
        'x-request-id': context.requestId,
      },
    })
  } catch (error: unknown) {
    return problemResponse(error, requestId)
  }
}

/**
 * The same glue for the operations that have no entity yet. Separate function
 * rather than an option, so that a route which forgot to scope itself to an
 * entity does not compile.
 */
export async function handleUnscoped(
  request: Request,
  work: (context: SetupContext) => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  let requestId: string | null = request.headers.get('x-request-id')

  try {
    const context = await resolveSetupContext({ database: getDatabase(), request })
    requestId = context.requestId

    const result = await work(context)
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json', 'x-request-id': context.requestId },
    })
  } catch (error: unknown) {
    return problemResponse(error, requestId)
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

export function searchParams(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams)
}

/**
 * Parse with a Zod schema, or fail with a problem document that names the
 * field. Shared by every route, so "400 Bad Request" never happens by accident.
 */
export function parse<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  what: string,
): z.output<TSchema> {
  const result = schema.safeParse(value)
  if (result.success) return result.data

  throw new ApiError(
    'validation_failed',
    `${what} is not valid.`,
    result.error.issues.map((issue) => ({
      code: 'invalid_request',
      path: issue.path.map(String).join('.') || null,
      message: issue.message,
    })),
  )
}
