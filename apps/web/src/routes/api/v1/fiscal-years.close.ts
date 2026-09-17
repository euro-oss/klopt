import { createFileRoute } from '@tanstack/react-router'
import { handleCloseYear } from '~/api/handlers/compliance'
import { closeYearBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

/**
 * Year close (spec 6.4). Two ordinary, reversible journal entries — so there is
 * no "reopen" endpoint here: you reverse the entries, like any other mistake.
 */
export const Route = createFileRoute('/api/v1/fiscal-years/close')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleCloseYear(
            context,
            parse(closeYearBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
