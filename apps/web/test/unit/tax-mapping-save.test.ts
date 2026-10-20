import { describe, expect, it } from 'vitest'
import {
  rollbackRejectedTaxMappings,
  taxViolationsByRateId,
} from '../../src/lib/tax-mapping-save.js'

describe('taxViolationsByRateId', () => {
  it('indexes taxRates.<id> messages and ignores other paths', () => {
    expect(
      taxViolationsByRateId([
        { path: 'taxRates.21', message: 'Sales cannot use VH21' },
        { path: 'accounts.1', message: 'ignored' },
        { path: null, message: 'nope' },
        { path: 'taxRates.22', message: '  ' },
      ]),
    ).toEqual({ '21': 'Sales cannot use VH21' })
  })
})

describe('rollbackRejectedTaxMappings', () => {
  it('restores prior values and drops newly added rejected ids', () => {
    expect(
      rollbackRejectedTaxMappings({
        previous: { '21': 'H21', '22': 'VH21' },
        attempted: { '21': 'VH21', '22': 'VH21', '23': 'L9' },
        rejectedIds: new Set(['21', '23']),
      }),
    ).toEqual({ '21': 'H21', '22': 'VH21' })
  })
})
