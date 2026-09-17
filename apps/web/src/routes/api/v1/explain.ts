import { createFileRoute } from '@tanstack/react-router'
import { handleExplainNumber } from '~/api/handlers/explain'
import { explainQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

/**
 * The lines behind a reported figure (spec 10.3), and whether they add up to
 * it. See the handler for why the second half of that sentence is the point.
 */
export const Route = createFileRoute('/api/v1/explain')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleExplainNumber(
            context,
            parse(explainQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
