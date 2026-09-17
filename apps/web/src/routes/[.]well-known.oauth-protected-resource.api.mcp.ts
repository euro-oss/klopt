import { createFileRoute } from '@tanstack/react-router'
import { protectedResourceMetadata } from '~/api/handlers/oauth'

/**
 * The same document at the path-suffixed location RFC 9728 defines for a
 * resource that is not at the root.
 *
 * The resource is `/api/mcp`, so a client following the spec to the letter asks
 * for `/.well-known/oauth-protected-resource/api/mcp`. Clients differ on which
 * they try, and serving one and not the other is a connection that fails for
 * reasons nobody can see.
 */
export const Route = createFileRoute('/.well-known/oauth-protected-resource/api/mcp')({
  server: { handlers: { GET: ({ request }) => protectedResourceMetadata(request) } },
})
