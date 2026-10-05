import { createFileRoute } from '@tanstack/react-router'
import { handleChooseMoneybirdAdministration } from '~/api/handlers/moneybird'
import { chooseMoneybirdAdministrationBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/moneybird/administration')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleChooseMoneybirdAdministration(
            context,
            parse(chooseMoneybirdAdministrationBody, await readJson(request), 'The request body'),
          ),
        ),
    },
  },
})
