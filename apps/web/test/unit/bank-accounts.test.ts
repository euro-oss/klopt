import { describe, expect, it } from 'vitest'
import { formatBankDayMonth, formatIbanDisplay } from '../../src/lib/bank-accounts.js'

describe('bank accounts display helpers (#129)', () => {
  it('groups the CoS example IBAN for display', () => {
    expect(formatIbanDisplay('NL91ABNA0417164300')).toBe('NL91 ABNA 0417 1643 00')
    expect(formatIbanDisplay('nl91 abna 0417 1643 00')).toBe('NL91 ABNA 0417 1643 00')
  })

  it('formats booking dates with the locale month name (NL reads “12 okt”)', () => {
    expect(formatBankDayMonth('2025-10-12', 'nl-NL')).toBe('12 okt')
    expect(formatBankDayMonth('2025-03-01', 'nl-NL')).toBe('1 mrt')
    expect(formatBankDayMonth('2025-12-12', 'en-GB')).toBe('12 Dec')
    expect(formatBankDayMonth('2025-03-01', 'en-GB')).toBe('1 Mar')
  })
})
