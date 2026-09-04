import { createFileRoute } from '@tanstack/react-router'
import { handleSetRgsMappings } from '~/api/handlers/compliance'
import { rgsMappingsBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/rgs/mappings')({
  server: {
    handlers: {
      PUT: ({ request }) =>
        handle(request, async (context) =>
          handleSetRgsMappings(
            context,
            parse(rgsMappingsBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
