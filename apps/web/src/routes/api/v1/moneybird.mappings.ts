import { createFileRoute } from '@tanstack/react-router'
import { handleSaveMoneybirdMappings } from '~/api/handlers/moneybird'
import { saveMoneybirdMappingsBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/moneybird/mappings')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleSaveMoneybirdMappings(
            context,
            parse(saveMoneybirdMappingsBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
