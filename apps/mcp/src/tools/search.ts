import { z } from 'zod'
import type { ToolContext } from '../context.js'
import { answer, money, type Answer } from '../provenance.js'

/**
 * `search` — "One entry point across invoices, contacts, entries and
 * documents" (spec 10.3).
 *
 * The one tool an agent reaches for when it has a word rather than an id, and
 * therefore the one most likely to be mistaken for a query tool. It is not:
 * `GET /api/v1/search` takes a substring and a list of resource names and
 * nothing else, so there is no filter to widen and nothing here that a script
 * with the same token could not ask for.
 *
 * Every hit carries `drillDown`. That is the point of the tool — it exists to
 * turn a word into ids the other tools take, not to answer the question
 * itself. An agent that summarises a search result is answering from titles.
 */

export const searchInput = z.object({
  query: z.string().min(2).describe('At least two characters. Matched as a substring.'),
  types: z
    .array(z.enum(['contact', 'sales-invoice', 'purchase-invoice', 'journal-entry', 'document']))
    .optional()
    .describe('Which resources to look in. Omit for all five.'),
  limit: z.number().int().min(1).max(50).optional().describe('Per resource. Defaults to 10.'),
})

interface Hit {
  readonly type: string
  readonly id: string
  readonly title: string
  readonly subtitle: string | null
  readonly date: string | null
  readonly amountMinorUnits: string | null
  readonly currency: string | null
  readonly path: string
}

interface SearchBody {
  readonly query: string
  readonly types: readonly string[]
  readonly limitPerType: number
  readonly results: readonly Hit[]
  readonly counts: Readonly<Record<string, number>>
  readonly truncated: readonly string[]
}

export async function search(
  context: ToolContext,
  input: z.infer<typeof searchInput>,
): Promise<Answer<Record<string, unknown>>> {
  const body = await context.api.get<SearchBody>('/search', {
    q: input.query,
    ...(input.types === undefined ? {} : { types: input.types.join(',') }),
    ...(input.limit === undefined ? {} : { limit: String(input.limit) }),
  })

  return answer(
    await context.provenance(['/api/v1/search']),
    {
      query: body.query,
      searched: body.types,
      counts: body.counts,
      results: body.results.map((hit) => ({
        type: hit.type,
        id: hit.id,
        title: hit.title,
        subtitle: hit.subtitle,
        date: hit.date,
        amount: hit.amountMinorUnits === null ? null : money(hit.amountMinorUnits),
        currency: hit.currency,
        drillDown: `GET /api/v1${hit.path}`,
      })),
    },
    // Per-resource rather than overall, so the sentence names what was cut.
    // The API's own `truncated` is the only thing that knows.
    body.truncated.length === 0
      ? undefined
      : {
          shown: body.results.length,
          totalCount: body.results.length,
          more: `More matches exist in: ${body.truncated.join(', ')}. Raise limit (up to 50), or narrow the query.`,
        },
  )
}
