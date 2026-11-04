import { describe, expect, it } from 'vitest'
import { isValidCalendarIsoDate, parseCalendarIsoDate } from '../../src/lib/calendar-iso-date.js'

describe('parseCalendarIsoDate', () => {
  it('accepts real calendar dates', () => {
    expect(parseCalendarIsoDate('2027-01-15')).toBe('2027-01-15')
  })

  it('rejects impossible calendar dates', () => {
    expect(parseCalendarIsoDate('2027-13-45')).toBeUndefined()
    expect(isValidCalendarIsoDate('2027-13-45')).toBe(false)
  })
})
