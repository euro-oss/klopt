import { createFileRoute } from '@tanstack/react-router'
import { getAuth } from '~/api/auth-instance'

/**
 * Sign out, and go somewhere.
 *
 * A thin wrapper over better-auth's endpoint, which exists for one reason: that
 * endpoint answers with JSON, so posting a plain form straight at it leaves the
 * user staring at `{"success":true}`. This returns a 303 instead.
 *
 * Deliberately a real form target rather than a fetch handler, so signing out
 * works before the page has hydrated and with JavaScript disabled. The
 * cookie-clearing headers come from better-auth; only the response shape
 * changes.
 */
export const Route = createFileRoute('/sign-out')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const response = await getAuth().api.signOut({
          headers: request.headers,
          asResponse: true,
        })

        const headers = new Headers({ location: '/sign-in' })
        for (const [name, value] of response.headers) {
          if (name.toLowerCase() === 'set-cookie') headers.append('set-cookie', value)
        }

        // 303: the browser must follow with GET, not repeat the POST.
        return new Response(null, { status: 303, headers })
      },
    },
  },
})
