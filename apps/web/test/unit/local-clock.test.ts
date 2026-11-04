import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestHandler } from '@tanstack/react-start/server'
import { bindE2eAsOfHeaderReader } from '../../src/lib/e2e-as-of-request.js'
import { ensureE2eAsOfServerBridge } from '../../src/lib/e2e-as-of-server-bridge.ts'
import { localTodayIso } from '../../src/lib/local-clock.js'

describe('localTodayIso', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00'))
    bindE2eAsOfHeaderReader(null)
    ensureE2eAsOfServerBridge()
    process.env['KLOPT_E2E_LEGAL_TOGGLE'] = '1'
    process.env['NODE_ENV'] = 'test'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    bindE2eAsOfHeaderReader(null)
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

  it('ignores the e2e as-of override when NODE_ENV is production', async () => {
    process.env['NODE_ENV'] = 'production'
    const handler = requestHandler(() => new Response(localTodayIso()))
    const response = await handler(
      new Request('http://localhost/', { headers: { 'X-Klopt-E2e-As-Of': '2026-01-01' } }),
    )
    expect(await response.text()).toBe('2026-03-15')
  })

  it('ignores the e2e as-of override when KLOPT_E2E_LEGAL_TOGGLE is not set', async () => {
    delete process.env['KLOPT_E2E_LEGAL_TOGGLE']
    const handler = requestHandler(() => new Response(localTodayIso()))
    const response = await handler(
      new Request('http://localhost/', { headers: { 'X-Klopt-E2e-As-Of': '2026-01-01' } }),
    )
    expect(await response.text()).toBe('2026-03-15')
  })

  it('uses the request header override when e2e gating is on', async () => {
    const handler = requestHandler(() => new Response(localTodayIso()))
    const withHeader = await handler(
      new Request('http://localhost/', { headers: { 'X-Klopt-E2e-As-Of': '2026-01-15' } }),
    )
    expect(await withHeader.text()).toBe('2026-01-15')

    const withoutHeader = await handler(new Request('http://localhost/'))
    expect(await withoutHeader.text()).toBe('2026-03-15')
  })
})
