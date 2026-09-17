import { createFileRoute } from '@tanstack/react-router'
import { handleReplayWebhook } from '~/api/handlers/webhooks'
import { replayWebhookBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Send it all again from a point in the stream (spec 10.2).
 *
 * Also what switches a disabled endpoint back on, because from the operator's
 * side those are the same act: something broke, it has been dealt with, carry
 * on from here.
 */
export const Route = createFileRoute('/api/v1/webhooks/$endpointId/replay')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, async (context) =>
          handleReplayWebhook(
            context,
            params.endpointId,
            parse(replayWebhookBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
