import { describe, expect, it, vi, afterEach } from 'vitest'
import headless from '../src/server-middleware/headless.js'
import apiV1Gate from '../src/server-middleware/api-v1.js'
import {
  apiV1Path,
  dispositionFor,
  templateMatches,
  unauthenticatedIfProtected,
} from '../src/api/routing.js'
import { ApiError } from '../src/api/errors.js'
import * as auth from '../src/api/auth.js'

/**
 * Unknown or wrong-method `/api/v1/*` requests (#237), at the routing layer and
 * in the Nitro gate that runs before the page renderer.
 */

const event = (url: string, init: RequestInit = {}) => ({
  req: new Request(url, init),
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('path matching', () => {
  it('reads the suffix under /api/v1', () => {
    expect(apiV1Path('/api/v1/journal-entries')).toBe('/journal-entries')
    expect(apiV1Path('/api/v1')).toBe('/')
    expect(apiV1Path('/sales/invoices')).toBeNull()
  })

  it('matches templates with parameters', () => {
    expect(templateMatches('/journal-entries/{entryId}', '/journal-entries/abc')).toBe(true)
    expect(templateMatches('/journal-entries/{entryId}', '/journal-entries')).toBe(false)
  })
})

describe('disposition', () => {
  it('delegates a known GET', () => {
    expect(dispositionFor('GET', '/api/v1/journal-entries')).toEqual({ kind: 'delegate' })
  })

  it('404s an unknown path', () => {
    expect(dispositionFor('GET', '/api/v1/no-such-operation')).toEqual({ kind: 'not_found' })
    expect(dispositionFor('POST', '/api/v1/no-such-operation')).toEqual({ kind: 'not_found' })
  })

  it('405s a wrong method with Allow', () => {
    const result = dispositionFor('PATCH', '/api/v1/journal-entries')
    expect(result.kind).toBe('method_not_allowed')
    if (result.kind === 'method_not_allowed') {
      expect(result.allow).toEqual(expect.arrayContaining(['GET', 'POST']))
    }
  })

  it('lets health and openapi through on GET only', () => {
    expect(dispositionFor('GET', '/api/v1/health')).toEqual({ kind: 'delegate' })
    expect(dispositionFor('POST', '/api/v1/health').kind).toBe('method_not_allowed')
  })
})

describe('auth before 405', () => {
  it('401s a protected route before 405 when signed out', async () => {
    vi.spyOn(auth, 'resolveRequestContext').mockRejectedValue(
      new ApiError('unauthenticated', 'Sign in, or present a bearer token.'),
    )
    const disposition = dispositionFor('DELETE', '/api/v1/journal-entries')
    const response = await unauthenticatedIfProtected(
      new Request('http://localhost:3000/api/v1/journal-entries', { method: 'DELETE' }),
      disposition,
    )
    expect(response?.status).toBe(401)
    const body = (await response?.json()) as { code: string }
    expect(body.code).toBe('unauthenticated')
  })
})

describe('the Nitro gate', () => {
  it('404s unknown verbs as JSON problem documents', async () => {
    const response = await apiV1Gate(event('http://localhost:3000/api/v1/unknown-endpoint', { method: 'GET' }))
    expect(response?.status).toBe(404)
    expect(response?.headers.get('content-type')).toBe('application/problem+json')
    const body = (await response?.json()) as { code: string }
    expect(body.code).toBe('not_found')
  })

  it('405s a wrong method with Allow when authenticated', async () => {
    vi.spyOn(auth, 'resolveRequestContext').mockResolvedValue({
      database: {} as never,
      actor: { kind: 'script', id: 't', principalId: null },
      entityId: '01',
      permissions: new Set(),
      requestId: 'req',
      ip: null,
      idempotencyKey: null,
      ifMatch: null,
    })

    const response = await apiV1Gate(
      event('http://localhost:3000/api/v1/journal-entries', {
        method: 'PATCH',
        headers: { authorization: 'Bearer test' },
      }),
    )
    expect(response?.status).toBe(405)
    expect(response?.headers.get('allow')).toMatch(/GET/)
    expect(response?.headers.get('allow')).toMatch(/POST/)
    const body = (await response?.json()) as { code: string }
    expect(body.code).toBe('method_not_allowed')
  })

  it('stands aside for non-API page routes', async () => {
    expect(await apiV1Gate(event('http://localhost:3000/sales/invoices'))).toBeUndefined()
    expect(headless(event('http://localhost:3000/sales/invoices'))).toBeUndefined()
  })

  it('stands aside for a real API handler', async () => {
    expect(
      await apiV1Gate(
        event('http://localhost:3000/api/v1/health', {
          method: 'GET',
        }),
      ),
    ).toBeUndefined()
  })
})