import { createFileRoute } from '@tanstack/react-router'
import { handleSetLegalHold } from '~/api/handlers/retention'
import { setLegalHoldBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * A legal hold suspends deletion regardless of the retention date, because a
 * dispute or an investigation outlives the bewaarplicht.
 */
export const Route = createFileRoute('/api/v1/retention/legal-hold')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleSetLegalHold(
            context,
            parse(setLegalHoldBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
