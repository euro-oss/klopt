import { createFileRoute } from '@tanstack/react-router'
import { handleGetEntity, handleUpdateEntity } from '~/api/handlers/setup'
import { updateEntityBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * The administration you are currently in. Singular and unparameterised: the
 * entity is resolved from the session or the token, never from the URL.
 */
export const Route = createFileRoute('/api/v1/entity')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleGetEntity(context)),
      PATCH: ({ request }) =>
        handle(request, async (context) =>
          handleUpdateEntity(
            context,
            parse(updateEntityBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
