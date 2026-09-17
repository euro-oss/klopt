import { createFileRoute } from '@tanstack/react-router'
import { authorizationServerMetadata } from '~/api/handlers/oauth'

/** RFC 8414. The endpoints and the one grant this server supports. */
export const Route = createFileRoute('/.well-known/oauth-authorization-server')({
  server: { handlers: { GET: ({ request }) => authorizationServerMetadata(request) } },
})
