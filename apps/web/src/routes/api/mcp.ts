import { createFileRoute } from '@tanstack/react-router'
import { handleMcpRequest } from '@klopt/mcp'
import { resolveToken } from '@klopt/db'
import { baseUrlFrom } from '~/api/handlers/oauth'
import { getDatabase } from '~/api/database'

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
/**
 * Check the token before anything else happens.
 *
 * The tool calls go back through the REST API, which authenticates them — but
 * `initialize` and `tools/list` make no API call at all, so without this the
 * endpoint answered them for **any non-empty string**. Anybody could enumerate
 * the tools, and a revoked token kept working for as long as nobody asked it
 * for data.
 *
 * Found by a test that revoked a token and expected the next call to fail. It
 * did not.
 */
async function authorised(request: Request, token: string): Promise<Response> {
  const resolved = await resolveToken(getDatabase(), token)

  if (resolved === null) {
    const base = baseUrlFrom(request)
    return new Response(
      JSON.stringify({ error: 'That token is not valid, has expired, or has been revoked.' }),
      {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'www-authenticate': `Bearer realm="klopt", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
        },
      },
    )
  }

  return handleMcpRequest(request, { baseUrl: baseUrlFrom(request), token })
}

export const Route = createFileRoute('/api/mcp')({
  server: {
    handlers: {
      POST: ({ request }) => {
        const header = request.headers.get('authorization') ?? ''
        const token = /^bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? ''

        if (token === '') {
          // RFC 9728: point at the metadata rather than only saying no. This
          // header is what turns a 401 into a connection — a client that
          // supports OAuth reads it, fetches the document, registers itself and
          // sends the user to the consent screen. Without it the only way in is
          // a human pasting a token, which is the thing hosting was supposed to
          // remove.
          const base = baseUrlFrom(request)

          return new Response(
            JSON.stringify({
              error:
                'This endpoint needs a bearer token. Authorise through OAuth, or issue one by hand under Toegang.',
            }),
            {
              status: 401,
              headers: {
                'content-type': 'application/json',
                'www-authenticate': `Bearer realm="klopt", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
              },
            },
          )
        }

        return authorised(request, token)
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
