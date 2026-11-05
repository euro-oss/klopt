import { describe, expect, it } from 'vitest'
import { LedgerError } from '../../src/errors.js'
import {
  FISCAL_YEAR_CODE_MAX,
  FISCAL_YEAR_CODE_MIN,
  assessDocumentFiscalYear,
  earliestOpenFiscalYear,
  fiscalYearCodeForDate,
  planFiscalYear,
  priorFiscalYearCodeToOpen,
} from '../../src/setup/fiscal-year.js'

describe('book-year labels for document dates', () => {
  it('uses the July label for a March date in a broken year', () => {
    expect(fiscalYearCodeForDate('2026-03-04', 7)).toBe('2025')
  })

  it('uses the calendar label in January', () => {
    expect(fiscalYearCodeForDate('2025-12-15', 1)).toBe('2025')
  })
})

describe('assessDocumentFiscalYear', () => {
  const open2026 = {
    code: '2026',
    startsOn: '2026-01-01',
    endsOn: '2026-12-31',
    status: 'open',
  }

  it('blocks when the year is missing', () => {
    expect(assessDocumentFiscalYear([open2026], '2025-12-15', 1)).toEqual({
      kind: 'blocked',
      code: '2025',
      reason: 'missing',
    })
  })

  it('passes when the year is open', () => {
    expect(
      assessDocumentFiscalYear(
        [{ ...open2026, code: '2025', startsOn: '2025-01-01', endsOn: '2025-12-31' }, open2026],
        '2025-12-15',
        1,
      ).kind,
    ).toBe('ok')
  })

  it('blocks when the year is closed', () => {
    expect(
      assessDocumentFiscalYear(
        [{ code: '2025', startsOn: '2025-01-01', endsOn: '2025-12-31', status: 'closed' }],
        '2025-06-01',
        1,
      ),
    ).toEqual({ kind: 'blocked', code: '2025', reason: 'closed' })
  })
})

describe('prior year to open', () => {
  it('is one below the earliest open year', () => {
    const earliest = earliestOpenFiscalYear([
      { code: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31', status: 'open' },
      { code: '2027', startsOn: '2027-01-01', endsOn: '2027-12-31', status: 'open' },
    ])
    expect(earliest?.code).toBe('2026')
    expect(priorFiscalYearCodeToOpen(earliest!.code)).toBe('2025')
  })

  it('is null at the configured floor so no prior year is offered', () => {
    expect(priorFiscalYearCodeToOpen('1960')).toBeNull()
    expect(priorFiscalYearCodeToOpen(String(FISCAL_YEAR_CODE_MIN))).toBeNull()
  })
})

describe('planFiscalYear range', () => {
  it('refuses implausible labels', () => {
    expect(() => planFiscalYear('1925', 1)).toThrow(LedgerError)
    expect(() => planFiscalYear('1959', 1)).toThrow(LedgerError)
    expect(() => planFiscalYear('2205', 1)).toThrow(LedgerError)
  })

  it('accepts the configured bounds', () => {
    expect(planFiscalYear(String(FISCAL_YEAR_CODE_MIN), 1).code).toBe(String(FISCAL_YEAR_CODE_MIN))
    expect(planFiscalYear(String(FISCAL_YEAR_CODE_MAX), 1).code).toBe(String(FISCAL_YEAR_CODE_MAX))
  })
})
