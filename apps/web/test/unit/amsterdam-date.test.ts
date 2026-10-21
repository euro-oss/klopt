import { describe, expect, it } from 'vitest'
import { calendarDateInTimeZone, todayInAmsterdam } from '../../src/lib/amsterdam-date.js'

describe('todayInAmsterdam', () => {
  it('matches Europe/Amsterdam at a comfortable afternoon hour', () => {
    // 2026-03-15 14:00 UTC = 15:00 Amsterdam (CET+1).
    const noonish = new Date('2026-03-15T14:00:00.000Z')
    expect(todayInAmsterdam(noonish)).toBe('2026-03-15')
  })

  it('is still today just after Amsterdam midnight while UTC is still yesterday', () => {
    // Winter: Amsterdam is UTC+1. 2026-01-15 00:30 Amsterdam = 2026-01-14 23:30 UTC.
    // `toISOString().slice(0, 10)` would wrongly return 2026-01-14 (#79).
    const justAfterMidnight = new Date('2026-01-14T23:30:00.000Z')
    expect(justAfterMidnight.toISOString().slice(0, 10)).toBe('2026-01-14')
    expect(todayInAmsterdam(justAfterMidnight)).toBe('2026-01-15')
  })

  it('handles the summer-time (CEST) midnight boundary the same way', () => {
    // Summer: Amsterdam is UTC+2. 2026-07-01 00:15 Amsterdam = 2026-06-30 22:15 UTC.
    const justAfterMidnight = new Date('2026-06-30T22:15:00.000Z')
    expect(justAfterMidnight.toISOString().slice(0, 10)).toBe('2026-06-30')
    expect(todayInAmsterdam(justAfterMidnight)).toBe('2026-07-01')
  })

  it('formats an arbitrary zone through calendarDateInTimeZone', () => {
    const instant = new Date('2026-01-14T23:30:00.000Z')
    expect(calendarDateInTimeZone(instant, 'UTC')).toBe('2026-01-14')
    expect(calendarDateInTimeZone(instant, 'Europe/Amsterdam')).toBe('2026-01-15')
  })
})
