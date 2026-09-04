import { beforeEach, describe, expect, it } from 'vitest'
import {
  DuplicateOperationError,
  InvalidOperationError,
  clearOperationsForTest,
  defineOperation,
  getOperation,
  listOperations,
} from '../src/operation.js'

const read = {
  id: 'ledger.getTrialBalance',
  kind: 'read',
  permission: 'ledger:read',
  summary: 'Trial balance for a period.',
  agentExposure: 'read',
  idempotent: true,
} as const

describe('operation registry', () => {
  beforeEach(() => {
    clearOperationsForTest()
  })

  it('registers and lists operations in a stable order', () => {
    defineOperation({ ...read, id: 'ledger.b' })
    defineOperation({ ...read, id: 'ledger.a' })
    expect(listOperations().map((o) => o.id)).toEqual(['ledger.a', 'ledger.b'])
  })

  it('looks an operation up by id', () => {
    defineOperation(read)
    expect(getOperation(read.id)?.permission).toBe('ledger:read')
    expect(getOperation('nope')).toBeUndefined()
  })

  it('rejects a duplicate id', () => {
    defineOperation(read)
    expect(() => defineOperation(read)).toThrow(DuplicateOperationError)
  })

  it('rejects a write that is not idempotent', () => {
    expect(() =>
      defineOperation({
        id: 'ledger.postJournalEntry',
        kind: 'write',
        permission: 'ledger:post',
        summary: 'Post an entry.',
        agentExposure: 'proposal',
        idempotent: false,
      }),
    ).toThrow(InvalidOperationError)
  })

  it('rejects a read that claims write-shaped agent exposure', () => {
    expect(() => defineOperation({ ...read, agentExposure: 'direct' })).toThrow(
      InvalidOperationError,
    )
  })
})
