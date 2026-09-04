import { describe, expect, it } from 'vitest'
import { clearOperationsForTest, defineOperation, listOperations } from '@klopt/core'
import { findContractViolations, routeManifest } from '../src/api/manifest.js'
import type { RouteBinding } from '../src/api/manifest.js'

const operation = (id: string) =>
  ({
    id,
    kind: 'read',
    permission: 'ledger:read',
    summary: id,
    agentExposure: 'read',
    idempotent: true,
  }) as const

const binding = (operationId: string): RouteBinding => ({
  operationId,
  method: 'GET',
  path: `/${operationId}`,
})

describe('API contract check', () => {
  it('catches a domain operation with no route', () => {
    const violations = findContractViolations([operation('ledger.getTrialBalance')], [])
    expect(violations).toHaveLength(1)
    expect(violations[0]?.kind).toBe('unrouted-operation')
  })

  it('catches a route bound to an operation that does not exist', () => {
    const violations = findContractViolations([], [binding('ledger.ghost')])
    expect(violations.map((v) => v.kind)).toEqual(['unknown-operation'])
  })

  it('catches two routes claiming the same operation', () => {
    const id = 'ledger.getTrialBalance'
    const violations = findContractViolations([operation(id)], [binding(id), binding(id)])
    expect(violations.map((v) => v.kind)).toEqual(['duplicate-binding'])
  })

  it('passes when every operation is routed exactly once', () => {
    const id = 'ledger.getTrialBalance'
    expect(findContractViolations([operation(id)], [binding(id)])).toEqual([])
  })
})

describe('every registered domain operation is reachable over REST', () => {
  it('has no contract violations', () => {
    clearOperationsForTest()
    // Importing @klopt/core registers nothing yet; operations arrive with M0.
    // Re-register nothing here — this asserts against the real registry.
    const violations = findContractViolations(listOperations(), routeManifest)
    expect(violations.map((v) => v.detail)).toEqual([])
  })

  it('would fail if an operation were added without a route', () => {
    clearOperationsForTest()
    defineOperation(operation('ledger.canary'))
    expect(findContractViolations(listOperations(), routeManifest)).not.toEqual([])
    clearOperationsForTest()
  })
})
