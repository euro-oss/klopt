import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { clearOperationsForTest, defineOperation, listOperations } from '@klopt/core'
import '@klopt/core'
import { findContractViolations, routeManifest } from '../src/api/manifest.js'
import type { RouteBinding } from '../src/api/manifest.js'
import * as schemas from '../src/api/schemas.js'

/**
 * The mechanism from spec 10.1, and the reason principle 3 is still true after
 * month six: a domain operation with no REST route fails the build.
 */

const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes')

const operation = (id: string) =>
  ({
    id,
    kind: 'read',
    permission: 'ledger:read',
    summary: id,
    agentExposure: 'read',
    idempotent: true,
  }) as const

const binding = (operationId: string, path = `/${operationId}`): RouteBinding => ({
  operationId,
  method: 'GET',
  path,
  module: 'api/v1/accounts.ts',
})

describe('the contract check itself', () => {
  it('catches a domain operation with no route', () => {
    const violations = findContractViolations([operation('ledger.getTrialBalance')], [])
    expect(violations).toHaveLength(1)
    expect(violations[0]?.kind).toBe('unrouted-operation')
  })

  it('catches a route bound to an operation that does not exist', () => {
    const violations = findContractViolations([], [binding('ledger.ghost')])
    expect(violations.map((v) => v.kind)).toEqual(['unknown-operation'])
  })

  it('catches one operation claiming two routes', () => {
    const id = 'ledger.getTrialBalance'
    const violations = findContractViolations(
      [operation(id)],
      [binding(id, '/a'), binding(id, '/b')],
    )
    expect(violations.map((v) => v.kind)).toEqual(['duplicate-binding'])
  })

  it('catches the same route declared twice', () => {
    const violations = findContractViolations(
      [operation('a'), operation('b')],
      [binding('a', '/same'), binding('b', '/same')],
    )
    expect(violations.map((v) => v.kind)).toContain('duplicate-binding')
  })

  it('passes when every operation is routed exactly once', () => {
    const id = 'ledger.getTrialBalance'
    expect(findContractViolations([operation(id)], [binding(id)])).toEqual([])
  })
})

describe('every registered domain operation is reachable over REST', () => {
  it('has no contract violations', () => {
    const violations = findContractViolations(listOperations(), routeManifest)
    expect(violations.map((v) => v.detail)).toEqual([])
  })

  it('covers the ledger operations, not an empty registry', () => {
    // Guards against the check passing because nothing imported the registry.
    const ids = listOperations().map((item) => item.id)
    expect(ids).toContain('ledger.postJournalEntry')
    expect(ids.length).toBeGreaterThanOrEqual(7)
  })

  it('points every binding at a route file that exists', () => {
    for (const item of routeManifest) {
      expect(existsSync(join(ROUTES_DIR, item.module)), item.module).toBe(true)
    }
  })

  it('would fail if an operation were added without a route', () => {
    defineOperation(operation('ledger.canary'))
    try {
      expect(findContractViolations(listOperations(), routeManifest)).not.toEqual([])
    } finally {
      clearOperationsForTest()
    }
  })
})

/**
 * The routes under /api/v1 that are not domain operations, and why.
 *
 * The manifest maps operations to routes. It has never said anything about a
 * route with no operation, so until this list existed you could add one and
 * nothing would notice — `/api/v1/health` had been there all along, correctly,
 * but by nobody's decision that survived in writing.
 */
const NOT_DOMAIN_ROUTES: Readonly<Record<string, string>> = {
  'api/v1/health.ts': 'Liveness. Says nothing about the database, on purpose.',
  'api/v1/openapi[.]json.ts': 'The API describing itself. A map is not a place on the map.',
}

/**
 * What each route file actually parses, read out of the source.
 *
 * The manifest *declares* the schemas; this reads what the route really uses,
 * and the test below compares them. Without it, `request` would be prose: a
 * renamed schema or a copy-pasted binding would leave the OpenAPI document
 * describing a body nobody sends, and a generated client would compile against
 * it and fail in production.
 */
function parsedSchemas(module: string): Record<string, { query?: string; body?: string }> {
  const source = readFileSync(join(ROUTES_DIR, module), 'utf8')
  const found: Record<string, { query?: string; body?: string }> = {}
  let method: string | null = null

  for (const line of source.split('\n')) {
    const isMethod = /^ {6}(GET|POST|PUT|PATCH|DELETE):/.exec(line)
    if (isMethod?.[1] !== undefined) {
      method = isMethod[1]
      found[method] ??= {}
    }
    const parsed =
      /parse\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(?:await\s+)?([A-Za-z_][A-Za-z0-9_]*)\(/.exec(line)
    if (parsed?.[1] !== undefined && method !== null) {
      const entry = (found[method] ??= {})
      if (parsed[2] === 'searchParams') entry.query = parsed[1]
      else if (parsed[2] === 'readJson') entry.body = parsed[1]
    }
  }
  return found
}

describe('the manifest describes what the routes actually do', () => {
  it('declares the schema each route parses, and no other', () => {
    const mismatches: string[] = []

    for (const binding of routeManifest) {
      const actual = parsedSchemas(binding.module)[binding.method] ?? {}
      const declared = binding.request ?? {}

      for (const kind of ['query', 'body'] as const) {
        if (actual[kind] !== declared[kind]) {
          mismatches.push(
            `${binding.method} /api/v1${binding.path}: manifest says ${kind} ` +
              `${declared[kind] ?? '(none)'}, the route parses ${actual[kind] ?? '(none)'}`,
          )
        }
      }
    }

    expect(mismatches).toEqual([])
  })

  it('names only schemas that exist', () => {
    for (const binding of routeManifest) {
      for (const name of [binding.request?.query, binding.request?.body]) {
        if (name === undefined) continue
        expect(Object.keys(schemas), `${binding.operationId} names ${name}`).toContain(name)
      }
    }
  })

  it('would catch a route that started parsing something else', () => {
    // The check is only worth having if a wrong declaration fails it.
    const [binding] = routeManifest.filter((item) => item.request?.body !== undefined)
    expect(binding).toBeDefined()
    const actual = parsedSchemas(binding!.module)[binding!.method]
    expect(actual?.body).toBe(binding!.request?.body)
    expect(actual?.body).not.toBe('somethingElseEntirely')
  })
})

describe('no route under /api/v1 exists outside the contract', () => {
  it('has every route file either in the manifest or on the short list', () => {
    const declared = new Set(routeManifest.map((binding) => binding.module))
    const orphans = readdirSync(join(ROUTES_DIR, 'api', 'v1'))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `api/v1/${name}`)
      .filter((module) => !declared.has(module) && !(module in NOT_DOMAIN_ROUTES))

    expect(orphans).toEqual([])
  })

  it('has no entry on that list for a file that is gone', () => {
    for (const module of Object.keys(NOT_DOMAIN_ROUTES)) {
      expect(existsSync(join(ROUTES_DIR, module)), module).toBe(true)
    }
  })

  it('has every HTTP method of every manifest route bound', () => {
    // A file in the manifest can still grow a second method nobody declared.
    const declared = new Set(routeManifest.map((b) => `${b.module} ${b.method}`))
    const missing: string[] = []

    for (const binding of routeManifest) {
      for (const method of Object.keys(parsedSchemas(binding.module))) {
        if (!declared.has(`${binding.module} ${method}`)) {
          missing.push(`${method} in ${binding.module}`)
        }
      }
    }

    expect([...new Set(missing)]).toEqual([])
  })
})

/**
 * The blind spot this check used to have.
 *
 * `parsedSchemas` recognises `parse(schema, searchParams(request))` and
 * `parse(schema, await readJson(request))`, which is how every route is
 * written — until two were not. `/api/v1/vat/periods` built its query object
 * by hand before parsing it, and `/api/v1/purchase-invoices` read `status` and
 * `openOnly` straight off the URL with no schema at all.
 *
 * Both were invisible here: an unrecognised shape looked exactly like a route
 * with no query. So the OpenAPI document omitted two query parameters, and one
 * of them was not validated either — `status` reached the repository as
 * whatever string was typed.
 *
 * Found by `test/response-shapes.test.ts`, which could not call those handlers
 * without knowing what to pass them. These two assertions are what would have
 * found it here, where it belongs.
 */
describe('a route cannot parse a query the manifest has not heard of', () => {
  /** Every `parse(` call in a route file, by method, however it is written. */
  function parseCallsIn(module: string): Record<string, number> {
    const source = readFileSync(join(ROUTES_DIR, module), 'utf8')
    const counts: Record<string, number> = {}
    let method: string | null = null

    for (const line of source.split('\n')) {
      const isMethod = /^ {6}(GET|POST|PUT|PATCH|DELETE):/.exec(line)
      if (isMethod?.[1] !== undefined) method = isMethod[1]
      if (method === null) continue
      counts[method] = (counts[method] ?? 0) + (/\bparse\(/.test(line) ? 1 : 0)
    }
    return counts
  }

  it('declares one schema for every parse the route performs', () => {
    const mismatches: string[] = []

    for (const binding of routeManifest) {
      const performed = parseCallsIn(binding.module)[binding.method] ?? 0
      const declared = Object.values(binding.request ?? {}).filter(
        (name) => name !== undefined,
      ).length

      if (performed !== declared) {
        mismatches.push(
          `${binding.method} /api/v1${binding.path}: parses ${String(performed)}, ` +
            `declares ${String(declared)}`,
        )
      }
    }

    expect(mismatches).toEqual([])
  })

  it('declares a query for every route that reads the query string', () => {
    // A route can read `searchParams` and never parse it, which is how
    // `purchase-invoices` lost its schema. Reading the URL at all is the
    // signal; what it does next is the part that was going wrong.
    const undeclared: string[] = []

    for (const binding of routeManifest) {
      const source = readFileSync(join(ROUTES_DIR, binding.module), 'utf8')
      const methods = source.split(/^ {6}(?=(?:GET|POST|PUT|PATCH|DELETE):)/m)
      const mine = methods.find((block) => block.startsWith(`${binding.method}:`))
      if (mine === undefined || !mine.includes('searchParams(')) continue
      if (binding.request?.query === undefined) {
        undeclared.push(`${binding.method} /api/v1${binding.path}`)
      }
    }

    expect(undeclared).toEqual([])
  })
})
