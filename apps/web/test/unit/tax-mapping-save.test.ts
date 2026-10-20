import { describe, expect, it } from 'vitest'
import {
  applyTaxMappingSaveFailure,
  formatTaxViolationMessage,
  rollbackRejectedTaxMappings,
  taxViolationsByRateId,
} from '../../src/lib/tax-mapping-save.js'
import type { MessageKey } from '../../src/i18n/nl.js'

const t = (key: MessageKey, values?: Readonly<Record<string, string>>): string => {
  if (key === 'finding.moneybird.incompatible_tax_rate') {
    return `Btw-tarief ${values?.['name'] ?? ''} (${values?.['percentage'] ?? ''}) past niet bij ${values?.['mappedCode'] ?? ''}: richting of percentage komt niet overeen met het schema.`
  }
  return key
}

describe('formatTaxViolationMessage', () => {
  it('prefers finding.<messageKey> over the English message', () => {
    expect(
      formatTaxViolationMessage(t, {
        path: 'taxRates.21',
        messageKey: 'moneybird.incompatible_tax_rate',
        message: 'Tax rate X cannot map to VH21',
        detail: { name: 'Hoog tarief verkoop', percentage: '21%', mappedCode: 'VH21' },
      }),
    ).toContain('past niet bij VH21')
  })

  it('falls back to message when messageKey is missing', () => {
    expect(
      formatTaxViolationMessage(t, {
        path: 'taxRates.21',
        message: 'Raw English fallback',
      }),
    ).toBe('Raw English fallback')
  })
})

describe('taxViolationsByRateId', () => {
  it('indexes taxRates.<id> with localised messages', () => {
    expect(
      taxViolationsByRateId(
        [
          {
            path: 'taxRates.21',
            messageKey: 'moneybird.incompatible_tax_rate',
            message: 'Tax rate …',
            detail: { name: 'Hoog', percentage: '21%', mappedCode: 'VH21' },
          },
          { path: 'accounts.1', message: 'ignored' },
        ],
        t,
      ),
    ).toEqual({
      '21': {
        message:
          'Btw-tarief Hoog (21%) past niet bij VH21: richting of percentage komt niet overeen met het schema.',
        messageKey: 'moneybird.incompatible_tax_rate',
      },
    })
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

describe('applyTaxMappingSaveFailure', () => {
  it('rolls back and returns localised violations', () => {
    const result = applyTaxMappingSaveFailure({
      previous: { '21': 'H21' },
      attempted: { '21': 'VH21' },
      violations: [
        {
          path: 'taxRates.21',
          messageKey: 'moneybird.incompatible_tax_rate',
          message: 'Tax rate …',
          detail: { name: 'Hoog tarief verkoop', percentage: '21%', mappedCode: 'VH21' },
        },
      ],
      t,
    })
    expect(result.taxMappings).toEqual({ '21': 'H21' })
    expect(result.rejectedIds).toEqual(['21'])
    expect(result.taxViolations['21']?.message).toMatch(/past niet bij VH21/)
  })
})
