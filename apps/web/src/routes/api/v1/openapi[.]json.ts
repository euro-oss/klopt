import { createFileRoute } from '@tanstack/react-router'
import { KLOPT_VERSION } from '@klopt/core'
import { buildOpenApiDocument } from '~/api/openapi'

/**
 * The API describing itself (spec 10.2).
 *
 * Unauthenticated, deliberately. An integrator needs to read the contract
 * before they have a token, and there is nothing in here that is not already
 * true of every Klopt instance — the paths, the schemas and the permission
 * names are the same in all of them. What differs is `servers`, which is the
 * URL they already typed to get here.
 *
 * Not in `routeManifest`, for the same reason `/api/v1/health` is not: the
 * manifest is the map of domain operations, and a description of that map is
 * not one of them. `test/contract.test.ts` requires every route under
 * `/api/v1` to be in the manifest or in its short list of exceptions, so this
 * is an entry in that list rather than an omission nobody noticed.
 */

let cached: string | null = null

function document(): string {
  // Built once. The manifest, the registry and the schemas are all module
  // constants, so the document cannot change without the process restarting.
  cached ??= JSON.stringify(
    buildOpenApiDocument({
      version: process.env['KLOPT_VERSION'] ?? KLOPT_VERSION,
      baseUrl: process.env['KLOPT_BASE_URL'],
    }),
    null,
    2,
  )
  return cached
}

export const Route = createFileRoute('/api/v1/openapi.json')({
  server: {
    handlers: {
      GET: () =>
        new Response(document(), {
          headers: {
            // The registered media type for OpenAPI, which is what a tool
            // sniffing the response looks for.
            'content-type': 'application/openapi+json',
            'cache-control': 'public, max-age=300',
          },
        }),
    },
  },
})
