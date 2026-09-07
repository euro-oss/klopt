import { createFileRoute } from '@tanstack/react-router'
import { handleDraftFromInbox } from '~/api/handlers/inbox'
import { draftFromInboxBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Turn an arrival into a purchase draft, with the original attached to it.
 * Spec 7.6's "linked to its postings" is that attachment.
 */
export const Route = createFileRoute('/api/v1/inbox/$itemId/draft')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, async (context) =>
          handleDraftFromInbox(
            context,
            params.itemId,
            parse(draftFromInboxBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
