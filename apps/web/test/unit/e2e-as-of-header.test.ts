import { describe, expect, it } from 'vitest'
import { isValidCalendarIsoDate, parseE2eAsOfHeader } from '../../src/lib/e2e-as-of-header.js'

describe('parseE2eAsOfHeader', () => {
  it('accepts real calendar dates', () => {
    expect(parseE2eAsOfHeader('2027-01-15')).toBe('2027-01-15')
  })

  it('rejects impossible calendar dates', () => {
    expect(parseE2eAsOfHeader('2027-13-45')).toBeUndefined()
    expect(isValidCalendarIsoDate('2027-13-45')).toBe(false)
  })
})
