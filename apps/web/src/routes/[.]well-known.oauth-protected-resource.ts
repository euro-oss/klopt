import { createFileRoute } from '@tanstack/react-router'
import { protectedResourceMetadata } from '~/api/handlers/oauth'

/**
 * RFC 9728. What an MCP client reads after a 401 to learn how to authenticate.
 *
 * The `[.]` escapes the leading dot for the file-based router; the URL is
 * `/.well-known/oauth-protected-resource`.
 */
export const Route = createFileRoute('/.well-known/oauth-protected-resource')({
  server: { handlers: { GET: ({ request }) => protectedResourceMetadata(request) } },
})
