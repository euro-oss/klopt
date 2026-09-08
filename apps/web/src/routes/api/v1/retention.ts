import { createFileRoute } from '@tanstack/react-router'
import { handleGetRetention } from '~/api/handlers/retention'
import { retentionQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

/** What is kept how long, what is held, and what could be deleted. */
export const Route = createFileRoute('/api/v1/retention')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleGetRetention(
            context,
            parse(retentionQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
