import { createFileRoute } from '@tanstack/react-router'
import { handleGetDunningQueue } from '~/api/handlers/sales'
import { dunningQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

/** Who to chase today, and with which letter. */
export const Route = createFileRoute('/api/v1/reports/dunning')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleGetDunningQueue(
            context,
            parse(dunningQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
