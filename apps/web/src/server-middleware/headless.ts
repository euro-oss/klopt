/**
 * Headless mode (spec 10.1).
 *
 * > `klopt serve --headless` starts the API and the worker with no web app
 * > mounted.
 *
 * This is what "no web app mounted" means at runtime: every path that is not
 * the API answers 404. A deployment where the UI still responds but nobody is
 * supposed to use it is not headless — it is a full install with a convention,
 * and conventions are not a security posture.
 *
 * ## What is allowed through
 *
 * `/api/**` — the versioned API, better-auth's endpoints, and the MCP server.
 * All three are machine surfaces. `/.well-known/**` too, because OAuth
 * discovery (RFC 8414, RFC 9728) is how an agent finds the authorisation
 * server, and an agent is exactly who is left when the UI is gone.
 *
 * ## What this does not claim
 *
 * Nitro composes its own public-asset middleware ahead of this one, so the few
 * hundred paths in the client manifest never reach here. In the full image
 * they are served, which is right. In the headless image the files are absent
 * and the read fails, so a request for one gets a 500 and a stack trace rather
 * than the refusal below — reachable only by someone holding an asset URL
 * taken from a different instance, since nothing headless ever emits one.
 * ADR 0042 records why that is left alone.
 *
 * The server *bundle* still contains the SSR code for routes nothing can now
 * reach. Excluding them at build time needs the route generator's
 * `routeFileIgnorePattern`, which this version of the TanStack Start plugin
 * accepts and ignores — see ADR 0042. So the headless image is smaller because
 * it ships no client assets, not because the server got smaller. That is worth
 * being precise about rather than rounding up.
 *
 * ## Why this does not import h3
 *
 * It would only be for `defineMiddleware`, which is a typing helper. `h3` is
 * not a direct dependency here and the version Nitro resolves is a release
 * candidate; pinning an rc in our own `package.json` to borrow one type is a
 * poor trade. The one field this reads is declared below instead.
 */

/** The sliver of the h3 event this needs. Structural, so nothing is imported. */
interface RequestEvent {
  readonly req: { readonly url: string }
}

/** Prefixes a machine can still reach with the UI switched off. */
const MACHINE_SURFACES = ['/api/', '/.well-known/']

export function isHeadless(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['KLOPT_HEADLESS'] === '1'
}

/** Whether headless mode should answer this path at all. */
export function servesPath(pathname: string): boolean {
  return MACHINE_SURFACES.some((prefix) => pathname.startsWith(prefix))
}

export default function headless(event: RequestEvent): Response | undefined {
  if (!isHeadless()) return undefined

  const { pathname } = new URL(event.req.url)
  if (servesPath(pathname)) return undefined

  // A problem document, like every other refusal from this server. A bare 404
  // would leave somebody wondering whether the path is wrong or the mode is.
  return new Response(
    JSON.stringify({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      code: 'headless',
      detail:
        'This instance runs headless: the API is mounted and the web app is not. ' +
        'Only /api and /.well-known answer here.',
    }),
    { status: 404, headers: { 'content-type': 'application/problem+json' } },
  )
}
