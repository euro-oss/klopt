import { describe, expect, it } from 'vitest'
import { formatIbanGroups, ibanTail } from '../../src/lib/iban-display.js'

describe('iban-display', () => {
  it('groups the registry example IBAN', () => {
    expect(formatIbanGroups('NL91ABNA0417164300')).toBe('NL91 ABNA 0417 1643 00')
    expect(formatIbanGroups('NL91 ABNA 0417 1643 00')).toBe('NL91 ABNA 0417 1643 00')
  })

  it('returns the last four for account labels', () => {
    expect(ibanTail('NL91ABNA0417164300')).toBe('4300')
  })
})
