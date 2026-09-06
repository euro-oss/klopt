import type { z } from 'zod'
import { getRequest } from '@tanstack/react-start/server'
import { resolveRequestContext, resolveSetupContext } from '~/api/auth'
import { getDatabase } from '~/api/database'
import { toProblem } from '~/api/errors'
import { parse } from '~/api/runtime'
import type { RequestContext, SetupContext } from '~/api/context'

/**
 * Helpers used **inside** server function handlers, never exported to a route.
 *
 * The distinction is load-bearing. TanStack Start strips `createServerFn`
 * handler bodies out of the client bundle and then drops the imports only they
 * used — so anything referenced solely inside a handler is free. An exported
 * top-level function cannot be stripped, and if a route imports the module that
 * defines it, its server-only imports follow it into the browser. Start's
 * import protection then fails the build, which is the correct outcome and a
 * confusing one if you do not know this rule.
 *
 * So: **a module a route imports must export nothing but server functions and
 * plain data.** Helpers live here.
 */

export async function contextFromRequest(entityId?: string): Promise<RequestContext> {
  return resolveRequestContext({
    database: getDatabase(),
    request: getRequest(),
    ...(entityId === undefined ? {} : { entityId }),
  })
}

/** The same, for the operations that exist because there is no entity yet. */
export async function setupContextFromRequest(): Promise<SetupContext> {
  return resolveSetupContext({ database: getDatabase(), request: getRequest() })
}

/**
 * Run a handler and flatten any failure into a problem document.
 *
 * Thrown errors serialise poorly across a server function boundary, and a UI
 * that receives `{}` when a posting is rejected cannot show the bookkeeper
 * which line was wrong. This keeps the violations — the useful part — intact.
 */
export async function run<T>(
  work: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; problem: ReturnType<typeof toProblem> }> {
  try {
    return { ok: true, data: await work() }
  } catch (error: unknown) {
    return { ok: false, problem: toProblem(error, null) }
  }
}

/**
 * Parse, then run — both inside the same `try`.
 *
 * A `createServerFn().validator()` that throws does **not** go through `run`:
 * the rejection escapes the server function entirely and the screen sees
 * nothing at all, which is the worst of the available failure modes. So the
 * validator passes the input through untouched and the parse happens here,
 * where a bad field comes back as a problem document with the path on it and
 * the form can point at the input that is wrong.
 */
export async function runWith<TSchema extends z.ZodType, T>(
  schema: TSchema,
  input: unknown,
  work: (data: z.output<TSchema>) => Promise<T>,
  what = 'The request body',
): Promise<{ ok: true; data: T } | { ok: false; problem: ReturnType<typeof toProblem> }> {
  return run(async () => work(parse(schema, input, what)))
}
