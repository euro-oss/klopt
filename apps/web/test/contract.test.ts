import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { clearOperationsForTest, defineOperation, listOperations } from '@klopt/core'
import '@klopt/core'
import { findContractViolations, routeManifest } from '../src/api/manifest.js'
import type { RouteBinding } from '../src/api/manifest.js'

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
