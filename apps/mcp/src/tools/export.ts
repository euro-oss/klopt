import { z } from 'zod'
import type { ToolContext } from '../context.js'
import { answer, type Answer } from '../provenance.js'

/**
 * `export_xaf` — "Period-scoped export, returns a reference rather than the
 * file body" (spec 10.3).
 *
 * The reference is the whole point. A twelve-month auditfile is megabytes of
 * XML, and putting it through a context window would spend the conversation on
 * data nobody is going to read a line of. What an agent needs is to know the
 * export is available, that it validated, how big it is, and the URL to hand to
 * whoever asked for it.
 *
 * So this tool checks the export can be produced and reports on it. It does not
 * carry it.
 */

export const exportXafInput = z.object({
  fiscalYear: z.string().min(1),
  fromPeriod: z.number().int().min(1).max(13).optional(),
  toPeriod: z.number().int().min(1).max(13).optional(),
})

export async function exportXaf(
  context: ToolContext,
  input: z.infer<typeof exportXafInput>,
): Promise<Answer<Record<string, unknown>>> {
  const query = new URLSearchParams({ fiscalYear: input.fiscalYear })
  if (input.fromPeriod !== undefined) query.set('fromPeriod', String(input.fromPeriod))
  if (input.toPeriod !== undefined) query.set('toPeriod', String(input.toPeriod))

  const path = `/exports/audit-file?${query.toString()}`

  // Fetched to prove it works, then measured rather than returned. An agent
  // that hands somebody a URL which turns out to 422 has wasted their time in
  // a way that is hard to trace back.
  const xml = await context.api.getText(path)

  return answer(
    await context.provenance([`/api/v1${path}`], {
      fiscalYear: input.fiscalYear,
      ...(input.fromPeriod === undefined ? {} : { fromPeriod: input.fromPeriod }),
      ...(input.toPeriod === undefined ? {} : { toPeriod: input.toPeriod }),
    }),
    {
      available: true,
      // Bytes, not the bytes. Deliberately.
      sizeBytes: new TextEncoder().encode(xml).length,
      format: 'XAF 3.2',
      url: `/api/v1${path}`,
      note: 'The auditfile is not returned here — it is megabytes of XML. Fetch the URL with the same token to download it.',
    },
  )
}
