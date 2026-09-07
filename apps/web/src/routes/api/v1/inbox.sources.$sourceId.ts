import { createFileRoute } from '@tanstack/react-router'
import { handleRemoveInboundSource } from '~/api/handlers/inbound-sources'
import { handle } from '~/api/runtime'

/** Stop taking documents from a source. What already arrived is untouched. */
export const Route = createFileRoute('/api/v1/inbox/sources/$sourceId')({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        handle(request, (context) => handleRemoveInboundSource(context, params.sourceId)),
    },
  },
})
