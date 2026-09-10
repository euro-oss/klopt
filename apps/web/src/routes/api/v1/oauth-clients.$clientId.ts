import { createFileRoute } from '@tanstack/react-router'
import { handleRevokeOAuthClient } from '~/api/handlers/tokens'
import { handle } from '~/api/runtime'

/** Withdraw an authorised app: its tokens die and its registration goes. */
export const Route = createFileRoute('/api/v1/oauth-clients/$clientId')({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        handle(request, (context) => handleRevokeOAuthClient(context, params.clientId)),
    },
  },
})
