import { createFileRoute } from '@tanstack/react-router'
import { handleRegisterClient } from '~/api/handlers/oauth'

/** RFC 7591. Open by necessity; a client id on its own grants nothing. */
export const Route = createFileRoute('/oauth/register')({
  server: { handlers: { POST: ({ request }) => handleRegisterClient(request) } },
})
