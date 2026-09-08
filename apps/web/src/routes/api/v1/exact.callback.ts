import { createFileRoute } from '@tanstack/react-router'
import { handleCompleteExactConnection } from '~/api/handlers/exact'
import { completeExactBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * The far side of Exact's OAuth handshake.
 *
 * The browser lands on the `/exact/callback` *screen*, which posts the code and
 * state here. Exact's registered redirect URI points at that screen rather than
 * at this route, so the API surface stays methods and bodies rather than
 * growing a doorway that only makes sense to a redirect.
 */
export const Route = createFileRoute('/api/v1/exact/callback')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleCompleteExactConnection(
            context,
            parse(completeExactBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
