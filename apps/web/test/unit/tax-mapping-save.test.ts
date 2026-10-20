import { describe, expect, it } from 'vitest'
import {
  applyTaxMappingSaveFailure,
  formatTaxMappingRollbackMessage,
  formatTaxViolationMessage,
  rollbackRejectedTaxMappings,
  taxViolationsByRateId,
} from '../../src/lib/tax-mapping-save.js'
import type { MessageKey } from '../../src/i18n/nl.js'

const t = (key: MessageKey, values?: Readonly<Record<string, string>>): string => {
  if (key === 'finding.moneybird.incompatible_tax_rate') {
    return `Btw-tarief ${values?.['name'] ?? ''} (${values?.['percentage'] ?? ''}) past niet bij ${values?.['mappedCode'] ?? ''}: richting of percentage komt niet overeen met het schema.`
  }
  if (key === 'moneybird.taxMapping.rollback') {
    return `${values?.['rejected'] ?? ''} is niet bewaard; ${values?.['current'] ?? ''} blijft staan.`
  }
  if (key === 'moneybird.taxMapping.rollbackCleared') {
    return `${values?.['rejected'] ?? ''} is niet bewaard.`
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

describe('formatTaxMappingRollbackMessage', () => {
  it('leads with rejected/current and appends the finding reason', () => {
    expect(
      formatTaxMappingRollbackMessage({
        t,
        rejected: 'VH21',
        current: 'H21',
        reason: 'Btw-tarief X past niet bij VH21.',
      }),
    ).toBe('VH21 is niet bewaard; H21 blijft staan. Btw-tarief X past niet bij VH21.')
  })
})

describe('taxViolationsByRateId', () => {
  it('indexes taxRates.<id> with rollback + localised messages', () => {
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
        { previous: { '21': 'H21' }, attempted: { '21': 'VH21' } },
      ),
    ).toEqual({
      '21': {
        message:
          'VH21 is niet bewaard; H21 blijft staan. Btw-tarief Hoog (21%) past niet bij VH21: richting of percentage komt niet overeen met het schema.',
        messageKey: 'moneybird.incompatible_tax_rate',
        rejected: 'VH21',
        current: 'H21',
      },
    })
  })

  it('skips path:null and blank-message rows', () => {
    expect(
      taxViolationsByRateId(
        [
          { path: null, message: 'ignored without path' },
          { path: 'taxRates.21', message: '' },
          { path: 'taxRates.22', message: '   ' },
          {
            path: 'taxRates.23',
            messageKey: 'moneybird.incompatible_tax_rate',
            message: 'Tax rate …',
            detail: { name: 'Laag', percentage: '9%', mappedCode: 'VH21' },
          },
        ],
        t,
        { previous: { '23': 'L9' }, attempted: { '23': 'VH21' } },
      ),
    ).toEqual({
      '23': {
        message:
          'VH21 is niet bewaard; L9 blijft staan. Btw-tarief Laag (9%) past niet bij VH21: richting of percentage komt niet overeen met het schema.',
        messageKey: 'moneybird.incompatible_tax_rate',
        rejected: 'VH21',
        current: 'L9',
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
    expect(result.taxViolations['21']?.message).toMatch(/^VH21 is niet bewaard; H21 blijft staan\./)
    expect(result.taxViolations['21']?.message).toMatch(/past niet bij VH21/)
  })
})
