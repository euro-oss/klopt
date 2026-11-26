import { uuidv7 } from '@klopt/core'
import {
  dispositionFor,
  methodNotAllowedResponse,
  notFoundResponse,
  unauthenticatedIfProtected,
  API_V1_PREFIX,
} from '../api/routing.js'

/**
 * Stop `/api/v1/*` from falling through to the HTML renderer (#237).
 *
 * Unknown paths become JSON 404s; known paths with the wrong verb become JSON
 * 405s with `Allow`. Where the path is not public, auth runs before the refusal
 * so an unsigned caller learns only that they are not signed in.
 */

interface RequestEvent {
  readonly method?: string
  readonly req:
    | Request
    | {
        readonly url: string
        readonly method?: string
        readonly headers?: HeadersInit
      }
}

function requestFrom(event: RequestEvent): Request {
  if (event.req instanceof Request) return event.req
  const method = event.method ?? event.req.method ?? 'GET'
  return new Request(event.req.url, { method, headers: event.req.headers ?? {} })
}

export default async function apiV1Gate(event: RequestEvent): Promise<Response | undefined> {
  const request = requestFrom(event)
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith(API_V1_PREFIX)) return undefined

  const method = request.method

  const disposition = dispositionFor(method, pathname)
  if (disposition.kind === 'delegate') return undefined

  const requestId = request.headers.get('x-request-id') ?? uuidv7()

  if (disposition.kind === 'not_found') {
    return notFoundResponse(requestId)
  }

  const auth = await unauthenticatedIfProtected(request, disposition)
  if (auth !== null) return auth

  if (disposition.kind !== 'method_not_allowed') return undefined

  return methodNotAllowedResponse(disposition.allow, requestId)
}
