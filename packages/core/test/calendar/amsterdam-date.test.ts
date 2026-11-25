import { afterEach, describe, expect, it, vi } from 'vitest'
import { todayInAmsterdam } from '../../src/calendar/amsterdam-date.js'

describe('todayInAmsterdam', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the Amsterdam calendar date when UTC is still yesterday (#121)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T00:30:00.000Z'))
    expect(todayInAmsterdam()).toBe('2026-11-01')
  })

  it('uses the Amsterdam calendar date at a CEST midnight boundary (#121)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T00:30:00.000Z'))
    expect(todayInAmsterdam()).toBe('2026-08-01')
  })
})
