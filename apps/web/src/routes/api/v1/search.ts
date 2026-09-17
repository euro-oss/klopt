import { createFileRoute } from '@tanstack/react-router'
import { handleSearch } from '~/api/handlers/search'
import { searchQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

/**
 * One entry point across invoices, contacts, entries and documents (spec 10.3).
 * A substring over a fixed list of columns, never a query language.
 */
export const Route = createFileRoute('/api/v1/search')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleSearch(context, parse(searchQuery, searchParams(request), 'The query string')),
        ),
    },
  },
})
