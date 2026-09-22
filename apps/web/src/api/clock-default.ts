import type { z } from 'zod'

/**
 * A default that is "whenever you ask", not a constant.
 *
 * The value is computed on every parse, which is right at runtime and wrong in
 * a published document: `z.toJSONSchema` evaluates it once, so the checked-in
 * `docs/openapi.json` carried the date it was generated on and disagreed with
 * a freshly generated one from the next morning. CI went red on a day nobody
 * had touched the code, which is the worst kind of red — the test that refuses
 * a stale copy was right, and the document was wrong.
 *
 * The marker rides into the JSON Schema output on `.meta()`, where
 * `openapi.ts` drops the pinned value and writes the behaviour down instead. A
 * reader wants "the default is today", not "the default is 17 September 2026".
 *
 * Here rather than in `schemas.ts` because everything exported from there is a
 * schema, and a test relies on that being true.
 */
export const CLOCK_DEFAULT = 'x-klopt-clock-default'

export function clockDefault<T extends z.ZodType>(schema: T, meaning: string): T {
  return schema.meta({ [CLOCK_DEFAULT]: meaning })
}
