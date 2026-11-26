import { uuidv7 } from '@klopt/core'
import { resolveRequestContext } from './auth.js'
import { getDatabase } from './database.js'
import { ApiError, problemResponse, toProblem } from './errors.js'
import { routeManifest, type HttpMethod, type RouteBinding } from './manifest.js'

/**
 * Whether a request targets the versioned API prefix, and if so whether it
 * should be answered before the page renderer sees it.
 *
 * TanStack matches a path with a declared route but no handler for the verb, or
 * no route at all, and falls through to HTML — which is a 500 or a page where
 * a client expects JSON. This module is the map the middleware reads.
 */

export const API_V1_PREFIX = '/api/v1'

const ALLOW_ORDER = ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'] as const

/**
 * Paths that exist but are not domain operations (`test/contract.test.ts`).
 * Wrong method on these does not require a session first.
 */
export const PUBLIC_PATHS: Readonly<Record<string, readonly HttpMethod[]>> = {
  '/health': ['GET'],
  '/openapi.json': ['GET'],
}

export type ApiV1Disposition =
  | { readonly kind: 'delegate' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'method_not_allowed'; readonly allow: string }
  | { readonly kind: 'unauthenticated' }

/** Strip `/api/v1` from a pathname; null when the request is not under the prefix. */
export function apiV1Path(pathname: string): string | null {
  if (pathname === API_V1_PREFIX) return '/'
  if (!pathname.startsWith(`${API_V1_PREFIX}/`)) return null
  const rest = pathname.slice(API_V1_PREFIX.length)
  if (rest === '') return '/'
  return rest
}

function pathExistsInManifest(suffix: string): boolean {
  return isPublicApiV1Path(suffix) || bestTemplateForPath(suffix) !== null
}

/**
 * When the gate cannot mirror TanStack's URL matching, it must not answer.
 */
export function gateMatchingUncertain(pathname: string): boolean {
  if (!pathname.startsWith(API_V1_PREFIX)) return false

  if (pathname.includes('%')) return true

  if (
    pathname.startsWith(`${API_V1_PREFIX}/`) &&
    pathname.endsWith('/') &&
    pathname !== `${API_V1_PREFIX}/`
  ) {
    const withoutSlash = pathname.slice(0, -1)
    const suffix = apiV1Path(withoutSlash)
    if (suffix !== null && suffix !== '/' && pathExistsInManifest(suffix)) return true
  }

  const suffix = apiV1Path(pathname)
  if (suffix === null || suffix === '/') return false

  if (suffix !== suffix.toLowerCase()) {
    const folded = suffix.toLowerCase()
    if (pathExistsInManifest(folded) && !pathExistsInManifest(suffix)) return true
  }

  return false
}

/** Match an OpenAPI-style template against a concrete path (both begin with `/`). */
export function templateMatches(template: string, actual: string): boolean {
  const templateParts = template.split('/').filter((part) => part !== '')
  const actualParts = actual.split('/').filter((part) => part !== '')
  if (templateParts.length !== actualParts.length) return false

  for (let index = 0; index < templateParts.length; index += 1) {
    const segment = templateParts[index] ?? ''
    const value = actualParts[index] ?? ''
    if (segment.startsWith('{') && segment.endsWith('}')) continue
    if (segment !== value) return false
  }

  return true
}

/** Literal segments in a template — more literals means a more specific route. */
export function templateSpecificity(template: string): number {
  return template.split('/').filter((part) => part !== '' && !part.startsWith('{')).length
}

const MANIFEST_TEMPLATES = [...new Set(routeManifest.map((binding) => binding.path))]

export function matchingTemplates(path: string): readonly string[] {
  return MANIFEST_TEMPLATES.filter((template) => templateMatches(template, path))
}

/** The single template the real router would pick among several that match. */
export function bestTemplateForPath(path: string): string | null {
  const matches = matchingTemplates(path)
  if (matches.length === 0) return null

  let best = matches[0]!
  let bestScore = templateSpecificity(best)
  for (const candidate of matches.slice(1)) {
    const score = templateSpecificity(candidate)
    if (score > bestScore || (score === bestScore && candidate.length > best.length)) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

function bindingsForPath(path: string): readonly RouteBinding[] {
  const template = bestTemplateForPath(path)
  if (template === null) return []
  return routeManifest.filter((binding) => binding.path === template)
}

function publicMethods(path: string): readonly HttpMethod[] | null {
  return PUBLIC_PATHS[path] ?? null
}

export function isPublicApiV1Path(path: string): boolean {
  return path in PUBLIC_PATHS
}

/** Wire `Allow` the way HTTP clients expect: HEAD listed whenever GET is. */
export function httpAllowHeader(methods: readonly HttpMethod[]): string {
  const names: string[] = methods.map((method) => method)
  if (methods.includes('GET') && !names.includes('HEAD')) names.push('HEAD')
  return [...names]
    .sort(
      (left, right) =>
        ALLOW_ORDER.indexOf(left as (typeof ALLOW_ORDER)[number]) -
        ALLOW_ORDER.indexOf(right as (typeof ALLOW_ORDER)[number]),
    )
    .join(', ')
}

function methodAllowed(verb: string, declared: readonly HttpMethod[]): 'delegate' | 'reject' {
  if (verb === 'OPTIONS') return 'delegate'
  if (verb === 'HEAD' && declared.includes('GET')) return 'delegate'
  if (declared.includes(verb as HttpMethod)) return 'delegate'
  return 'reject'
}

/**
 * What should happen to this request before TanStack routing.
 *
 * `delegate` when the manifest already has this exact path and method — the
 * route file owns the rest, including auth inside `handle`.
 */
export function dispositionFor(method: string, pathname: string): ApiV1Disposition {
  const path = apiV1Path(pathname)
  if (path === null) return { kind: 'delegate' }
  if (gateMatchingUncertain(pathname)) return { kind: 'delegate' }

  const verb = method.toUpperCase()
  if (verb === 'OPTIONS') return { kind: 'delegate' }

  const publicAllowed = publicMethods(path)

  if (publicAllowed !== null) {
    if (methodAllowed(verb, publicAllowed) === 'delegate') return { kind: 'delegate' }
    return { kind: 'method_not_allowed', allow: httpAllowHeader(publicAllowed) }
  }

  const bindings = bindingsForPath(path)
  if (bindings.length === 0) return { kind: 'not_found' }

  const declared = [...new Set(bindings.map((binding) => binding.method))]
  if (methodAllowed(verb, declared) === 'delegate') return { kind: 'delegate' }

  return {
    kind: 'method_not_allowed',
    allow: httpAllowHeader(declared),
  }
}

export function methodNotAllowedResponse(allow: string, requestId: string | null): Response {
  const header = allow
  const error = new ApiError(
    'method_not_allowed',
    `This URL does not accept that method. Try one of: ${header}.`,
  )
  const problem = toProblem(error, requestId)
  return new Response(JSON.stringify(problem), {
    status: 405,
    headers: {
      'content-type': 'application/problem+json',
      allow: header,
      ...(requestId === null ? {} : { 'x-request-id': requestId }),
    },
  })
}

export function notFoundResponse(requestId: string | null): Response {
  return problemResponse(new ApiError('not_found', 'No such URL.'), requestId)
}

/**
 * Refuse a protected path before 404/405 would reveal which verbs exist.
 * Returns null when the caller may proceed to the refusal itself.
 */
export async function unauthenticatedIfProtected(
  request: Request,
  disposition: ApiV1Disposition,
): Promise<Response | null> {
  if (disposition.kind !== 'method_not_allowed') return null

  const pathname = new URL(request.url).pathname
  if (gateMatchingUncertain(pathname)) return null

  const path = apiV1Path(pathname)
  if (path === null || isPublicApiV1Path(path)) return null

  const requestId = request.headers.get('x-request-id') ?? uuidv7()

  try {
    await resolveRequestContext({ database: getDatabase(), request })
    return null
  } catch (error: unknown) {
    if (error instanceof ApiError && error.code === 'unauthenticated') {
      return problemResponse(error, requestId)
    }
    throw error
  }
}
