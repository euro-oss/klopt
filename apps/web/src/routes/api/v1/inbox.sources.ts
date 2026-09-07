import { createFileRoute } from '@tanstack/react-router'
import { handleAddInboundSource, handleListInboundSources } from '~/api/handlers/inbound-sources'
import { addInboundSourceBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/** Where this administration receives documents from, and adding one. */
export const Route = createFileRoute('/api/v1/inbox/sources')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListInboundSources(context)),
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleAddInboundSource(
            context,
            parse(addInboundSourceBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
