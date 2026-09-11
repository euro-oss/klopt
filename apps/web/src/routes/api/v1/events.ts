import { createFileRoute } from '@tanstack/react-router'
import { handleListEvents } from '~/api/handlers/events'
import { eventsQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

/**
 * The event stream, for anybody who cannot be called back.
 *
 * `GET` and cursor-paged: hand back the `nextCursor` you were given and you
 * get what has happened since. Same rows the webhooks will read, same order.
 */
export const Route = createFileRoute('/api/v1/events')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, async (context) =>
          handleListEvents(context, parse(eventsQuery, searchParams(request), 'The query')),
        ),
    },
  },
})
