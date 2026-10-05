import { createFileRoute } from '@tanstack/react-router'
import { handleListMoneybirdAdministrations } from '~/api/handlers/moneybird'
import { handle } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/moneybird/administrations')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) => handleListMoneybirdAdministrations(context)),
    },
  },
})
