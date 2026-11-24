import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calendarYearInAmsterdam, todayInAmsterdam } from '../src/amsterdam-date.js'

/** 2027-01-01 00:30 Amsterdam (CET) while UTC is still 2026-12-31 (#217). */
const NEW_YEAR_AMSTERDAM_MIDNIGHT = new Date('2026-12-31T23:30:00.000Z')

/** 2026-12-31 23:30 Amsterdam while UTC is still 2026-12-31 22:30. */
const OLD_YEAR_AMSTERDAM_EVE = new Date('2026-12-31T22:30:00.000Z')

describe('CLI calendarYearInAmsterdam (#217)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the new Amsterdam year just after local midnight on 1 January', () => {
    vi.setSystemTime(NEW_YEAR_AMSTERDAM_MIDNIGHT)
    expect(todayInAmsterdam()).toBe('2027-01-01')
    expect(calendarYearInAmsterdam()).toBe(2027)
  })

  it('uses the old Amsterdam year late on 31 December', () => {
    vi.setSystemTime(OLD_YEAR_AMSTERDAM_EVE)
    expect(todayInAmsterdam()).toBe('2026-12-31')
    expect(calendarYearInAmsterdam()).toBe(2026)
  })
})