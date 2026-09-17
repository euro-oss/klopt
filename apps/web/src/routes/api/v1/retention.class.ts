import { createFileRoute } from '@tanstack/react-router'
import { handleSetRetentionClass } from '~/api/handlers/retention'
import { setRetentionClassBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/** Ten years rather than seven, for documents about onroerend goed. */
export const Route = createFileRoute('/api/v1/retention/class')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleSetRetentionClass(
            context,
            parse(setRetentionClassBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
