import { createFileRoute } from '@tanstack/react-router'
import { handleDiscardInboxItem } from '~/api/handlers/inbox'
import { discardInboxItemBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/** Set an arrival aside, with a reason. The document itself is kept. */
export const Route = createFileRoute('/api/v1/inbox/$itemId/discard')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, async (context) =>
          handleDiscardInboxItem(
            context,
            params.itemId,
            parse(discardInboxItemBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
