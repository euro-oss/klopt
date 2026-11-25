import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todayInAmsterdam } from '@klopt/core/calendar/amsterdam-date'

describe('MCP list_open_items asOf default (#121)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to Amsterdam today when UTC is still yesterday', () => {
    vi.setSystemTime(new Date('2026-10-31T23:30:00.000Z'))
    expect(todayInAmsterdam()).toBe('2026-11-01')
  })
})