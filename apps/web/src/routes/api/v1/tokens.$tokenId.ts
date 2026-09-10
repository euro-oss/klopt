import { createFileRoute } from '@tanstack/react-router'
import { handleRevokeToken } from '~/api/handlers/tokens'
import { handle } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/tokens/$tokenId')({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        handle(request, (context) => handleRevokeToken(context, params.tokenId)),
    },
  },
})
