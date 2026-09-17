import { createFileRoute } from '@tanstack/react-router'
import { handleCreateWebhook, handleListWebhooks } from '~/api/handlers/webhooks'
import { createWebhookBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Subscriptions to the event stream (spec 10.2).
 *
 * The `POST` response is the only time the signing secret exists outside the
 * database in a readable form. Same bargain as an API token.
 */
export const Route = createFileRoute('/api/v1/webhooks')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, async (context) => handleListWebhooks(context)),
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleCreateWebhook(
            context,
            parse(createWebhookBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
