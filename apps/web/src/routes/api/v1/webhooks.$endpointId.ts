import { createFileRoute } from '@tanstack/react-router'
import { handleDeleteWebhook } from '~/api/handlers/webhooks'
import { handle } from '~/api/runtime'

/**
 * Unsubscribing.
 *
 * A real `DELETE`, unlike the contact erasure next door: the row goes, the
 * secret goes with it, and nothing that happened is affected. The event stream
 * is untouched — this stops one reader, not the record.
 */
export const Route = createFileRoute('/api/v1/webhooks/$endpointId')({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        handle(request, async (context) => handleDeleteWebhook(context, params.endpointId)),
    },
  },
})
