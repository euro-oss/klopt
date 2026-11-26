import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import headless from '../src/server-middleware/headless.js'
import apiV1Gate from '../src/server-middleware/api-v1.js'
import { routeManifest } from '../src/api/manifest.js'
import {
  apiV1Path,
  bestTemplateForPath,
  dispositionFor,
  gateMatchingUncertain,
  httpAllowHeader,
  isTemplateParamSegment,
  templateMatches,
  templateSpecificity,
  unauthenticatedIfProtected,
} from '../src/api/routing.js'
import { ApiError } from '../src/api/errors.js'
import * as auth from '../src/api/auth.js'

/**
 * Unknown or wrong-method `/api/v1/*` requests (#237), at the routing layer and
 * in the Nitro gate that runs before the page renderer.
 */

const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes')

const NOT_DOMAIN_ROUTES = ['api/v1/health.ts', 'api/v1/openapi[.]json.ts']

const MANIFEST_PARAM_SAMPLE = '00000000-0000-7000-8000-000000000099'

/** Turn a manifest path template into a concrete URL suffix under `/api/v1`. */
function concreteManifestPath(template: string): string {
  return template
    .replace(/\{[^}]+\}/g, MANIFEST_PARAM_SAMPLE)
    .replace(/:[^/]+/g, MANIFEST_PARAM_SAMPLE)
}

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
    expect(apiV1Path('/api/v1/')).toBe('/')
    expect(apiV1Path('/sales/invoices')).toBeNull()
  })

  it('defers to the router when matching is uncertain', () => {
    expect(gateMatchingUncertain('/api/v1/health/')).toBe(true)
    expect(gateMatchingUncertain('/api/v1/journal%2Dentries')).toBe(true)
    expect(gateMatchingUncertain('/api/v1/openapi.JSON')).toBe(true)
    expect(gateMatchingUncertain('/api/v1/journal-entries')).toBe(false)
    expect(gateMatchingUncertain('/api/v1/')).toBe(false)
    expect(gateMatchingUncertain('/api/v1/health//')).toBe(true)
    expect(gateMatchingUncertain('/api/v1//health')).toBe(true)
    expect(gateMatchingUncertain('/api/v1/openapi.json//')).toBe(true)
  })

  it('matches templates with parameters', () => {
    expect(templateMatches('/journal-entries/{entryId}', '/journal-entries/abc')).toBe(true)
    expect(templateMatches('/journal-entries/{entryId}', '/journal-entries')).toBe(false)
    expect(templateMatches('/webhooks/:endpointId', '/webhooks/abc')).toBe(true)
    expect(isTemplateParamSegment(':endpointId')).toBe(true)
    expect(templateSpecificity('/webhooks/:endpointId')).toBe(
      templateSpecificity('/webhooks/{endpointId}'),
    )
  })

  it('prefers a static segment over a parameter segment', () => {
    expect(templateSpecificity('/journal-entries/batch')).toBeGreaterThan(
      templateSpecificity('/journal-entries/{entryId}'),
    )
    expect(bestTemplateForPath('/journal-entries/batch')).toBe('/journal-entries/batch')
    expect(bestTemplateForPath('/tax-codes/offers')).toBe('/tax-codes/offers')
  })
})

const OPENAPI_SPEC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'docs',
  'openapi.json',
)

describe('manifest coverage for the gate', () => {
  it('uses OpenAPI brace path parameters only (no :segment params)', () => {
    for (const binding of routeManifest) {
      for (const segment of binding.path.split('/').filter((part) => part !== '')) {
        expect(segment.includes(':'), `${binding.path} segment ${segment}`).toBe(false)
      }
    }

    const spec = JSON.parse(readFileSync(OPENAPI_SPEC_PATH, 'utf8')) as {
      paths: Record<string, unknown>
    }
    for (const path of Object.keys(spec.paths)) {
      for (const segment of path.split('/').filter((part) => part !== '')) {
        expect(segment.includes(':'), `openapi path ${path} segment ${segment}`).toBe(false)
      }
    }
  })

  it('has every route file in the manifest or on the public-path list', () => {
    const declared = new Set(routeManifest.map((binding) => binding.module))
    const orphans = readdirSync(join(ROUTES_DIR, 'api', 'v1'))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `api/v1/${name}`)
      .filter((module) => !declared.has(module) && !NOT_DOMAIN_ROUTES.includes(module))

    expect(orphans).toEqual([])
    for (const module of NOT_DOMAIN_ROUTES) {
      expect(existsSync(join(ROUTES_DIR, module)), module).toBe(true)
    }
  })
})

describe('manifest templates the gate must recognise', () => {
  it('delegates for every declared method on each manifest path', () => {
    for (const binding of routeManifest) {
      const suffix = concreteManifestPath(binding.path)
      const disposition = dispositionFor(binding.method, `/api/v1${suffix}`)
      expect(
        disposition,
        `${binding.method} /api/v1${binding.path} → ${JSON.stringify(disposition)}`,
      ).toEqual({ kind: 'delegate' })
    }
  })

  it('delegates webhook and contact pseudonymise templates from the manifest', () => {
    const sample = MANIFEST_PARAM_SAMPLE
    expect(dispositionFor('POST', `/api/v1/contacts/${sample}/pseudonymise`)).toEqual({
      kind: 'delegate',
    })
    expect(dispositionFor('DELETE', `/api/v1/webhooks/${sample}`)).toEqual({ kind: 'delegate' })
    expect(dispositionFor('POST', `/api/v1/webhooks/${sample}/replay`)).toEqual({
      kind: 'delegate',
    })
  })
})

describe('double-slash URLs', () => {
  it('delegates through the gate without answering', () => {
    for (const pathname of [
      '/api/v1/health//',
      '/api/v1/openapi.json//',
      '/api/v1//health',
      '/api/v1/journal-entries//',
    ]) {
      expect(dispositionFor('GET', pathname)).toEqual({ kind: 'delegate' })
      expect(dispositionFor('PATCH', pathname)).toEqual({ kind: 'delegate' })
    }
  })

  it('does not 404 or 405 at the Nitro gate', async () => {
    expect(
      await apiV1Gate(event('http://localhost:3000/api/v1/webhooks//', { method: 'PATCH' })),
    ).toBeUndefined()
  })
})

describe('disposition', () => {
  it('delegates a known GET', () => {
    expect(dispositionFor('GET', '/api/v1/journal-entries')).toEqual({ kind: 'delegate' })
  })

  it('delegates HEAD and OPTIONS like the real router', () => {
    expect(dispositionFor('HEAD', '/api/v1/journal-entries')).toEqual({ kind: 'delegate' })
    expect(dispositionFor('OPTIONS', '/api/v1/journal-entries')).toEqual({ kind: 'delegate' })
    expect(dispositionFor('HEAD', '/api/v1/health')).toEqual({ kind: 'delegate' })
    expect(dispositionFor('OPTIONS', '/api/v1/health')).toEqual({ kind: 'delegate' })
  })

  it('delegates when URL matching is uncertain', () => {
    expect(dispositionFor('GET', '/api/v1/health/')).toEqual({ kind: 'delegate' })
    expect(dispositionFor('PATCH', '/api/v1/journal%2Dentries')).toEqual({ kind: 'delegate' })
    expect(dispositionFor('GET', '/api/v1/openapi.JSON')).toEqual({ kind: 'delegate' })
  })

  it('404s an unknown path', () => {
    expect(dispositionFor('GET', '/api/v1/no-such-operation')).toEqual({ kind: 'not_found' })
    expect(dispositionFor('POST', '/api/v1/no-such-operation')).toEqual({ kind: 'not_found' })
    expect(dispositionFor('GET', '/api/v1')).toEqual({ kind: 'not_found' })
    expect(dispositionFor('GET', '/api/v1/')).toEqual({ kind: 'not_found' })
  })

  it('405s journal-entries with the full method set including HEAD', () => {
    const result = dispositionFor('PATCH', '/api/v1/journal-entries')
    expect(result).toEqual({ kind: 'method_not_allowed', allow: 'GET, HEAD, POST' })
  })

  it('405s the batch URL with POST only', () => {
    expect(dispositionFor('GET', '/api/v1/journal-entries/batch')).toEqual({
      kind: 'method_not_allowed',
      allow: 'POST',
    })
  })

  it('405s tax-codes/offers with GET and HEAD only', () => {
    expect(dispositionFor('PATCH', '/api/v1/tax-codes/offers')).toEqual({
      kind: 'method_not_allowed',
      allow: 'GET, HEAD',
    })
  })

  it('lets health and openapi through on GET and HEAD only', () => {
    expect(dispositionFor('GET', '/api/v1/health')).toEqual({ kind: 'delegate' })
    expect(dispositionFor('HEAD', '/api/v1/health')).toEqual({ kind: 'delegate' })
    expect(dispositionFor('POST', '/api/v1/health')).toEqual({
      kind: 'method_not_allowed',
      allow: 'GET, HEAD',
    })
  })

  it('lists HEAD in Allow whenever GET is listed', () => {
    expect(httpAllowHeader(['GET', 'POST'])).toBe('GET, HEAD, POST')
    expect(httpAllowHeader(['POST'])).toBe('POST')
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
    const response = await apiV1Gate(
      event('http://localhost:3000/api/v1/unknown-endpoint', { method: 'GET' }),
    )
    expect(response?.status).toBe(404)
    expect(response?.headers.get('content-type')).toBe('application/problem+json')
    const body = (await response?.json()) as { code: string }
    expect(body.code).toBe('not_found')
  })

  it('404s the bare /api/v1 prefix as JSON', async () => {
    const response = await apiV1Gate(event('http://localhost:3000/api/v1', { method: 'GET' }))
    expect(response?.status).toBe(404)
  })

  it('405s a wrong method with an exact Allow header when authenticated', async () => {
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
    expect(response?.headers.get('allow')).toBe('GET, HEAD, POST')
  })

  it('401s at the gate before 405 when signed out on a protected route', async () => {
    vi.spyOn(auth, 'resolveRequestContext').mockRejectedValue(
      new ApiError('unauthenticated', 'Sign in, or present a bearer token.'),
    )

    const response = await apiV1Gate(
      event('http://localhost:3000/api/v1/journal-entries', { method: 'PATCH' }),
    )
    expect(response?.status).toBe(401)
    const body = (await response?.json()) as { code: string }
    expect(body.code).toBe('unauthenticated')
  })

  it('405s batch and offers overlap URLs with the specific Allow value', async () => {
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

    const batch = await apiV1Gate(
      event('http://localhost:3000/api/v1/journal-entries/batch', { method: 'GET' }),
    )
    expect(batch?.headers.get('allow')).toBe('POST')

    const offers = await apiV1Gate(
      event('http://localhost:3000/api/v1/tax-codes/offers', { method: 'PATCH' }),
    )
    expect(offers?.headers.get('allow')).toBe('GET, HEAD')
  })

  it('delegates uncertain paths without rewriting the URL', async () => {
    const paths = [
      'http://localhost:3000/api/v1/health/',
      'http://localhost:3000/api/v1/openapi.JSON',
      'http://localhost:3000/api/v1/journal%2Dentries',
    ]
    for (const url of paths) {
      expect(await apiV1Gate(event(url, { method: 'GET' }))).toBeUndefined()
      expect(await apiV1Gate(event(url, { method: 'HEAD' }))).toBeUndefined()
      expect(await apiV1Gate(event(url, { method: 'OPTIONS' }))).toBeUndefined()
    }
  })

  it('delegates HEAD on routes that support GET', async () => {
    for (const url of [
      'http://localhost:3000/api/v1/health',
      'http://localhost:3000/api/v1/openapi.json',
      'http://localhost:3000/api/v1/journal-entries',
      'http://localhost:3000/api/v1/entity',
    ]) {
      expect(await apiV1Gate(event(url, { method: 'HEAD' }))).toBeUndefined()
    }
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

const PREFLIGHT_FIXTURE = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      'fixtures',
      'api-v1-options-preflight.headers.json',
    ),
    'utf8',
  ),
) as { status: number; headers: Record<string, string> }

const PREFLIGHT_TEST_PORT = 33_981

async function waitForBuiltServer(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`built server exited with code ${String(child.exitCode)}`)
    }
    try {
      const probe = await fetch(`http://127.0.0.1:${String(port)}/api/v1/health`)
      if (probe.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`built server did not listen on ${String(port)} within 30s`)
}

describe('OPTIONS preflight on the built server', () => {
  it('keeps response headers the same as on main', async () => {
    const bundle = fileURLToPath(new URL('../.output/server/index.mjs', import.meta.url))
    expect(
      existsSync(bundle),
      'Build apps/web first: this exercises the Nitro bundle like verify does.',
    ).toBe(true)

    const child = spawn('node', [bundle], {
      env: {
        ...process.env,
        PORT: String(PREFLIGHT_TEST_PORT),
        HOST: '127.0.0.1',
        NODE_ENV: 'test',
        DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgres://klopt:klopt@localhost:5432/klopt',
        KLOPT_ENCRYPTION_KEY:
          process.env['KLOPT_ENCRYPTION_KEY'] ?? '01234567890123456789012345678901',
      },
      stdio: 'pipe',
    })

    try {
      await waitForBuiltServer(PREFLIGHT_TEST_PORT, child)

      const response = await fetch(
        `http://127.0.0.1:${String(PREFLIGHT_TEST_PORT)}/api/v1/health`,
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://example.test',
            'Access-Control-Request-Method': 'GET',
          },
        },
      )

      expect(response.status).toBe(PREFLIGHT_FIXTURE.status)
      for (const [name, value] of Object.entries(PREFLIGHT_FIXTURE.headers)) {
        expect(response.headers.get(name)).toBe(value)
      }
      expect(response.headers.get('allow')).toBeNull()
    } finally {
      child.kill('SIGTERM')
    }
  }, 60_000)
})
