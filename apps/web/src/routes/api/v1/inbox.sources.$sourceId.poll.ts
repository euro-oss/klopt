import { createFileRoute } from '@tanstack/react-router'
import { handlePollInboundSource } from '~/api/handlers/inbound-sources'
import { handle } from '~/api/runtime'

/**
 * Take what is waiting now.
 *
 * The same path the worker's schedule runs, so pressing the button proves the
 * schedule works rather than proving something else does.
 */
export const Route = createFileRoute('/api/v1/inbox/sources/$sourceId/poll')({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handle(request, (context) => handlePollInboundSource(context, params.sourceId)),
    },
  },
})
