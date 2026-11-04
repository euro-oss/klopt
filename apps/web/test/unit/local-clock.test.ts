import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localTodayIso } from '../../src/lib/local-clock.js'
import { bindE2eAsOfReader } from '../../src/lib/e2e-as-of-request.js'
import '../../src/lib/e2e-as-of-store.js'

describe('localTodayIso', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00'))
    bindE2eAsOfReader(() => null)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    bindE2eAsOfReader(() => null)
  })

  it('returns the real local calendar date when process is undefined', () => {
    const saved = globalThis.process
    vi.stubGlobal('process', undefined)
    try {
      expect(localTodayIso()).toBe('2026-03-15')
    } finally {
      vi.stubGlobal('process', saved)
    }
  })

  it('ignores the e2e as-of override when NODE_ENV is production', () => {
    vi.stubGlobal('process', { env: { NODE_ENV: 'production', KLOPT_E2E_LEGAL_TOGGLE: '1' } })
    bindE2eAsOfReader(() => '2026-01-01')
    expect(localTodayIso()).toBe('2026-03-15')
  })

  it('ignores the e2e as-of override when KLOPT_E2E_LEGAL_TOGGLE is not set', () => {
    vi.stubGlobal('process', { env: { NODE_ENV: 'test' } })
    bindE2eAsOfReader(() => '2026-01-01')
    expect(localTodayIso()).toBe('2026-03-15')
  })

  it('uses the request-scoped override when e2e gating is on', () => {
    vi.stubGlobal('process', { env: { NODE_ENV: 'test', KLOPT_E2E_LEGAL_TOGGLE: '1' } })
    bindE2eAsOfReader(() => '2026-01-15')
    expect(localTodayIso()).toBe('2026-01-15')
    bindE2eAsOfReader(() => null)
    expect(localTodayIso()).toBe('2026-03-15')
  })
})
