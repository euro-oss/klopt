import { createFileRoute } from '@tanstack/react-router'
import { handleMcpRequest } from '@klopt/mcp'

/**
 * The MCP endpoint, mounted where Klopt already is (spec 10.3).
 *
 * Hosted deployments are the point. stdio only works when the agent and the
 * books share a machine, which for a customer of a hosted Klopt means
 * installing a local Node process and keeping a token in a config file. Here
 * the address is just the instance: `https://books.example.org/api/mcp`, same
 * TLS, same tokens, nothing extra to deploy.
 *
 * ## Outside `/api/v1`, deliberately
 *
 * This is a protocol endpoint, not a REST resource. Putting it under `/api/v1`
 * would imply it is one of the versioned operations the contract test
 * enumerates, and it is not — it is a second way to reach all of them. Its
 * versioning is MCP's own.
 *
 * ## It still calls the REST API, even from inside the same process
 *
 * The token is forwarded to a client pointed back at this instance, so a tool
 * call becomes an ordinary authenticated HTTP request that lands on the
 * ordinary handler, checks the ordinary permission and writes the ordinary
 * audit entry.
 *
 * Calling the handlers directly from here would save a loopback hop and would
 * be the beginning of the second path ADR 0035 exists to prevent — one where
 * an agent reaches something a script cannot, because nobody noticed the two
 * routes had drifted. The hop costs a few milliseconds on the same host and
 * buys the guarantee that there is exactly one way in.
 */
export const Route = createFileRoute('/api/mcp')({
  server: {
    handlers: {
      POST: ({ request }) => {
        const header = request.headers.get('authorization') ?? ''
        const token = /^bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? ''

        if (token === '') {
          // 401 with the scheme, so a client knows what to present rather than
          // guessing. MCP clients that support OAuth read this.
          return new Response(
            JSON.stringify({
              error:
                'This endpoint needs a bearer token. Issue one in Klopt under Toegang; a read-only token is enough for every tool.',
            }),
            {
              status: 401,
              headers: {
                'content-type': 'application/json',
                'www-authenticate': 'Bearer realm="klopt"',
              },
            },
          )
        }

        // Its own origin. `KLOPT_BASE_URL` is what the instance calls itself
        // everywhere else; the request's own origin is the fallback for a
        // deployment that has not set it.
        const baseUrl = process.env['KLOPT_BASE_URL'] ?? new URL(request.url).origin

        return handleMcpRequest(request, { baseUrl, token })
      },

      GET: () =>
        new Response(
          JSON.stringify({
            error:
              'Only POST is supported. This endpoint is stateless: one JSON-RPC message per request, no SSE stream.',
          }),
          { status: 405, headers: { 'content-type': 'application/json', allow: 'POST' } },
        ),
    },
  },
})
