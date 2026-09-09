import { z } from 'zod'
import type { ToolContext } from '../context.js'
import { answer, type Answer } from '../provenance.js'

/**
 * `vat_return_preview` — "The return as it currently stands, with the
 * reconciliation" (spec 10.3).
 *
 * Read-only, and it stays that way. Filing is `vat.fileReturn`, which is not
 * exposed here at all: "an agent filing a BTW-aangifte unsupervised is a legal
 * problem, so make it structurally impossible rather than discouraged."
 *
 * The reconciliation travels with the figures for the same reason it does on
 * the screen. A rubriek total that does not tie back to the journal is the one
 * number nobody should quote, and an agent cannot know that unless it is told.
 */

export const vatReturnPreviewInput = z.object({
  period: z
    .string()
    .min(1)
    .describe('The period code, e.g. "2026-Q1" or "2026-03". See vat/periods.'),
})

interface VatReturn {
  readonly period: string
  readonly status?: string
  readonly currency?: string
  readonly rubrieken?: unknown
  readonly reconciliation?: unknown
  readonly warnings?: unknown
}

export async function vatReturnPreview(
  context: ToolContext,
  input: z.infer<typeof vatReturnPreviewInput>,
): Promise<Answer<Record<string, unknown>>> {
  const body = await context.api.get<VatReturn>(`/vat/returns/${encodeURIComponent(input.period)}`)

  return answer(
    await context.provenance([`/api/v1/vat/returns/${input.period}`], { from: input.period }),
    {
      ...body,
      // Named rather than implied. An agent asked "have we filed Q1" should not
      // have to infer the answer from the absence of a field.
      filed: body.status === 'filed' || body.status === 'accepted',
      note: 'This is the return as it stands now. Filing is deliberately not available to an agent — it is a human action.',
    },
  )
}
