import { createFileRoute } from '@tanstack/react-router'
import { handleListAccounts } from '~/api/handlers/ledger'
import { handle } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/accounts')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleListAccounts(context)),
    },
  },
})
