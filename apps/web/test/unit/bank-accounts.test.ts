import { describe, expect, it } from 'vitest'
import { formatBankDayMonth, formatIbanDisplay } from '../../src/lib/bank-accounts.js'

describe('bank accounts display helpers (#129)', () => {
  it('groups the CoS example IBAN for display', () => {
    expect(formatIbanDisplay('NL91ABNA0417164300')).toBe('NL91 ABNA 0417 1643 00')
    expect(formatIbanDisplay('nl91 abna 0417 1643 00')).toBe('NL91 ABNA 0417 1643 00')
  })

  it('formats booking dates as day + month abbr', () => {
    expect(formatBankDayMonth('2025-12-12')).toBe('12 Dec')
    expect(formatBankDayMonth('2025-03-01')).toBe('1 Mar')
  })
})
