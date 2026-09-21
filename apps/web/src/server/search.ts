import { createServerFn } from '@tanstack/react-start'
import { handleSearch } from '~/api/handlers/search'
import { searchQuery } from '~/api/schemas'
import { contextFromRequest, runWith } from './internal'

/**
 * One search across the five resources, for the command palette.
 *
 * The same handler `GET /api/v1/search` calls and the MCP `search` tool
 * consumes, so the palette is a third caller of one read rather than a query of
 * its own — which is what keeps "results respect the caller" a property of the
 * operation instead of a promise the UI makes. `ledger:read` gates it, and a
 * role without it gets a problem document the palette shows.
 *
 * `runWith` rather than `run`: the query has a schema with a minimum length on
 * it, and a two-character rule enforced in one place is a rule. The palette
 * knows the same number (`~/lib/palette-search`) so that it can wait for the
 * second character rather than show somebody a validation failure for typing.
 */
export const searchContent = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      searchQuery,
      data,
      async (query) => (await handleSearch(await contextFromRequest(), query)).body,
      'The search query',
    ),
  )
