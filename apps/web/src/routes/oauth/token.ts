import { createFileRoute } from '@tanstack/react-router'
import { handleToken } from '~/api/handlers/oauth'

/** Code plus PKCE verifier in, bearer token out. */
export const Route = createFileRoute('/oauth/token')({
  server: { handlers: { POST: ({ request }) => handleToken(request) } },
})
