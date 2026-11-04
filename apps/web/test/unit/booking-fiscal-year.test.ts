import { describe, expect, it } from 'vitest'
import { assessDocumentFiscalYear } from '@klopt/core'
import { nl } from '../../src/i18n/nl.js'

describe('booking fiscal year gate copy', () => {
  it('names a missing year under the date field message', () => {
    expect(nl['booking.fiscalYearNotOpen']).toContain('{year}')
    expect(nl['booking.fiscalYearOpenLink']).toContain('{year}')
    expect(nl['booking.taxCodeInvalidOnDate']).toContain('Kies een andere')
  })

  it('blocks December in January when only the current year exists', () => {
    const gate = assessDocumentFiscalYear(
      [{ code: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31', status: 'open' }],
      '2025-12-15',
      1,
    )
    expect(gate).toEqual({ kind: 'blocked', code: '2025', reason: 'missing' })
  })
})
