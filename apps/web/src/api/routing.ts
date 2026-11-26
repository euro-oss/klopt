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

/**
 * Paths that exist but are not domain operations (`test/contract.test.ts`).
 * Wrong method on these does not require a session first.
 */
export const PUBLIC_PATHS: Readonly<
  Record<string, readonly HttpMethod[]>
> = {
  '/health': ['GET'],
  '/openapi.json': ['GET'],
}

export type ApiV1Disposition =
  | { readonly kind: 'delegate' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'method_not_allowed'; readonly allow: readonly HttpMethod[] }
  | { readonly kind: 'unauthenticated' }

/** Strip `/api/v1` and normalise; null when the request is not under the prefix. */
export function apiV1Path(pathname: string): string | null {
  if (pathname === API_V1_PREFIX) return '/'
  if (!pathname.startsWith(`${API_V1_PREFIX}/`)) return null
  const rest = pathname.slice(API_V1_PREFIX.length)
  if (rest === '') return '/'
  return rest
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

function bindingsForPath(path: string): readonly RouteBinding[] {
  const templates = new Set(routeManifest.map((binding) => binding.path))
  const matches = [...templates].filter((template) => templateMatches(template, path))
  if (matches.length === 0) return []
  return routeManifest.filter((binding) => matches.includes(binding.path))
}

function publicMethods(path: string): readonly HttpMethod[] | null {
  return PUBLIC_PATHS[path] ?? null
}

export function isPublicApiV1Path(path: string): boolean {
  return path in PUBLIC_PATHS
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

  const verb = method.toUpperCase()
  const publicAllowed = publicMethods(path)

  if (publicAllowed !== null) {
    if (publicAllowed.includes(verb as HttpMethod)) return { kind: 'delegate' }
    return { kind: 'method_not_allowed', allow: publicAllowed }
  }

  const bindings = bindingsForPath(path)
  if (bindings.length === 0) return { kind: 'not_found' }

  const allowed = [...new Set(bindings.map((binding) => binding.method))].sort()
  const hasMethod = bindings.some((binding) => binding.method === verb)
  if (hasMethod) return { kind: 'delegate' }

  return { kind: 'method_not_allowed', allow: allowed }
}

export function methodNotAllowedResponse(
  allow: readonly HttpMethod[],
  requestId: string | null,
): Response {
  const error = new ApiError(
    'method_not_allowed',
    `This URL does not accept that method. Try one of: ${allow.join(', ')}.`,
  )
  const problem = toProblem(error, requestId)
  return new Response(JSON.stringify(problem), {
    status: 405,
    headers: {
      'content-type': 'application/problem+json',
      allow: allow.join(', '),
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

  const path = apiV1Path(new URL(request.url).pathname)
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