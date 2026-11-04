import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('localTodayIso', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00'))
    vi.resetModules()
    process.env['KLOPT_E2E_LEGAL_TOGGLE'] = '1'
    process.env['NODE_ENV'] = 'test'
    delete process.env['KLOPT_E2E_TODAY_ISO']
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
    delete process.env['KLOPT_E2E_TODAY_ISO']
  })

  async function loadLocalClock() {
    return import('../../src/lib/local-clock.js')
  }

  it('returns the real local calendar date when process is undefined', async () => {
    const { localTodayIso } = await loadLocalClock()
    const saved = globalThis.process
    vi.stubGlobal('process', undefined)
    try {
      expect(localTodayIso()).toBe('2026-03-15')
    } finally {
      vi.stubGlobal('process', saved)
    }
  })

  it('ignores KLOPT_E2E_TODAY_ISO when NODE_ENV is production', async () => {
    process.env['NODE_ENV'] = 'production'
    process.env['KLOPT_E2E_TODAY_ISO'] = '2026-01-01'
    const { localTodayIso } = await loadLocalClock()
    expect(localTodayIso()).toBe('2026-03-15')
  })

  it('ignores KLOPT_E2E_TODAY_ISO when KLOPT_E2E_LEGAL_TOGGLE is not set', async () => {
    delete process.env['KLOPT_E2E_LEGAL_TOGGLE']
    process.env['KLOPT_E2E_TODAY_ISO'] = '2026-01-01'
    const { localTodayIso } = await loadLocalClock()
    expect(localTodayIso()).toBe('2026-03-15')
  })

  it('uses KLOPT_E2E_TODAY_ISO read at process start when e2e gating is on', async () => {
    process.env['KLOPT_E2E_TODAY_ISO'] = '2026-01-15'
    const { localTodayIso } = await loadLocalClock()
    expect(localTodayIso()).toBe('2026-01-15')
  })

  it('does not follow KLOPT_E2E_TODAY_ISO mutations after module import', async () => {
    process.env['KLOPT_E2E_TODAY_ISO'] = '2027-06-10'
    const { localTodayIso } = await loadLocalClock()
    expect(localTodayIso()).toBe('2027-06-10')
    process.env['KLOPT_E2E_TODAY_ISO'] = '2027-12-25'
    expect(localTodayIso()).toBe('2027-06-10')
    delete process.env['KLOPT_E2E_TODAY_ISO']
    expect(localTodayIso()).toBe('2027-06-10')
  })

  it('rejects impossible calendar dates in KLOPT_E2E_TODAY_ISO', async () => {
    process.env['KLOPT_E2E_TODAY_ISO'] = '2027-13-45'
    const { localTodayIso } = await loadLocalClock()
    expect(localTodayIso()).toBe('2026-03-15')
  })
})
