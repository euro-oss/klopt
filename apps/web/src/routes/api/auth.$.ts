import { createFileRoute } from '@tanstack/react-router'
import { getAuth } from '~/api/auth-instance'

/**
 * better-auth's own endpoints: sign-in, sign-up, sign-out, session.
 *
 * Deliberately **not** under `/api/v1`. That prefix is the product's public,
 * versioned contract; this is the library's surface and it versions on the
 * library's schedule, not ours. Keeping them apart means the contract test —
 * which requires every `/api/v1` route to correspond to a domain operation —
 * stays meaningful.
 */
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => getAuth().handler(request),
      POST: ({ request }) => getAuth().handler(request),
    },
  },
})
