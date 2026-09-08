import { createFileRoute } from '@tanstack/react-router'
import {
  handleConnectExact,
  handleDisconnectExact,
  handleGetExactConnection,
} from '~/api/handlers/exact'
import { connectExactBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/** The Exact Online connection: what it is, registering one, forgetting it. */
export const Route = createFileRoute('/api/v1/exact/connection')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleGetExactConnection(context)),
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleConnectExact(
            context,
            parse(connectExactBody, await readJson(request), 'The request body'),
          ),
        ),
      DELETE: ({ request }) => handle(request, (context) => handleDisconnectExact(context)),
    },
  },
})
