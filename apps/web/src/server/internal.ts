import type { z } from 'zod'
import { getRequest } from '@tanstack/react-start/server'
import { resolveRequestContext, resolveSetupContext } from '~/api/auth'
import { getDatabase } from '~/api/database'
import { toProblem } from '~/api/errors'
import { parse } from '~/api/runtime'
import type { RequestContext, SetupContext } from '~/api/context'
import { handleListFiscalYears } from '~/api/handlers/setup'
import {
  REPORT_YEAR_COOKIE,
  isFiscalYearCode,
  resolveFiscalYear,
  type FiscalYearOption,
  type FiscalYearScope,
} from '~/lib/fiscal-year'

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

export interface ContextOptions {
  readonly entityId?: string | undefined
  /**
   * The key the screen generated for this attempt. Required for every write:
   * a browser cannot set an `Idempotency-Key` header on a server-function
   * call, so the key travels in the payload instead.
   */
  readonly idempotencyKey?: string | undefined
}

export async function contextFromRequest(options: ContextOptions = {}): Promise<RequestContext> {
  return resolveRequestContext({
    database: getDatabase(),
    request: getRequest(),
    ...(options.entityId === undefined ? {} : { entityId: options.entityId }),
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
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
/** Today, as the books write it. */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** The year the reader chose, as it arrived on the request. */
export function requestedReportYear(): string | null {
  const cookies = getRequest().headers.get('cookie') ?? ''
  const match = new RegExp(`(?:^|;\\s*)${REPORT_YEAR_COOKIE}=([^;]*)`).exec(cookies)
  return isFiscalYearCode(match?.[1]) ? match[1] : null
}

/**
 * Which book year this request is about.
 *
 * Resolved here rather than in each screen, and from the administration's own
 * book years rather than from the calendar: a boekjaar that runs July to June
 * is a supported setup, and `new Date().getFullYear()` answers a different
 * question than the one every report on this screen is asking.
 *
 * An administration with no book years at all — which setup cannot produce,
 * but a half-migrated database can — falls back to the calendar year rather
 * than failing, and `years` comes back empty so the shell shows no picker.
 */
export async function reportYear(
  context: RequestContext,
  requested: string | null = requestedReportYear(),
): Promise<{ readonly years: readonly FiscalYearOption[]; readonly scope: FiscalYearScope }> {
  const listed = await handleListFiscalYears(context)
  const years = listed.body.fiscalYears as readonly FiscalYearOption[]
  const now = today()
  const scope = resolveFiscalYear(years, requested, now)

  return {
    years,
    scope: scope ?? {
      code: now.slice(0, 4),
      startsOn: `${now.slice(0, 4)}-01-01`,
      endsOn: `${now.slice(0, 4)}-12-31`,
      isCurrent: true,
      asOf: now,
    },
  }
}

/**
 * Read something in the book year the reader chose.
 *
 * The screen may still name a year — a link to a specific one, a test — and
 * then that is what it gets. What it must not do is leave the year out and
 * have the server guess the calendar, which is what every report did before
 * this existed.
 *
 * The context is resolved once and handed to the handler, so the year and the
 * figures come from the same request rather than from two.
 */
export async function runScoped<TSchema extends z.ZodType, T>(
  schema: TSchema,
  input: unknown,
  work: (context: RequestContext, query: z.output<TSchema>) => Promise<T>,
  what = 'The request query',
): Promise<{ ok: true; data: T } | { ok: false; problem: ReturnType<typeof toProblem> }> {
  return run(async () => {
    const context = await contextFromRequest()
    const given = (input as { fiscalYear?: unknown } | null)?.fiscalYear
    const named = typeof given === 'string' && given !== ''
    const scoped = named
      ? (input as object)
      : { ...(input as object | null), fiscalYear: (await reportYear(context)).scope.code }

    return work(context, parse(schema, scoped, what))
  })
}

export async function runWith<TSchema extends z.ZodType, T>(
  schema: TSchema,
  input: unknown,
  work: (data: z.output<TSchema>) => Promise<T>,
  what = 'The request body',
): Promise<{ ok: true; data: T } | { ok: false; problem: ReturnType<typeof toProblem> }> {
  return run(async () => work(parse(schema, input, what)))
}
