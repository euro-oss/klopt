import { beforeAll, describe, expect, it, vi } from 'vitest'
import { requestHandler } from '@tanstack/react-start/server'
import { ensureE2eAsOfServerBridge } from '../src/lib/e2e-as-of-server-bridge.ts'
import { localTodayIso } from '../src/lib/local-clock.js'

/**
 * Reproduces QA's 60 interleaved requests: each HTTP request must read its own
 * `X-Klopt-E2e-As-Of` via TanStack Start's request-scoped `getRequestHeader`.
 */
describe('localTodayIso e2e as-of under concurrent requests', () => {
  beforeAll(() => {
    ensureE2eAsOfServerBridge()
  })

  it('returns the matching date for 60 interleaved header patterns', async () => {
    process.env['KLOPT_E2E_LEGAL_TOGGLE'] = '1'
    process.env['NODE_ENV'] = 'test'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T12:00:00'))

    const handler = requestHandler(() => new Response(localTodayIso()))

    const cases: { header: string | undefined; expected: string }[] = []
    for (let i = 0; i < 20; i++) {
      cases.push({ header: '2027-01-15', expected: '2027-01-15' })
      cases.push({ header: undefined, expected: '2026-11-04' })
      cases.push({ header: '2027-06-01', expected: '2027-06-01' })
    }

    const results = await Promise.all(
      cases.map(async ({ header, expected }) => {
        const headers = header === undefined ? {} : { 'X-Klopt-E2e-As-Of': header }
        const response = await handler(new Request('http://localhost/contacts', { headers }))
        const body = await response.text()
        return { expected, body }
      }),
    )

    const wrong = results.filter((row) => row.body !== row.expected)
    expect(wrong, JSON.stringify(wrong.slice(0, 5))).toEqual([])

    vi.useRealTimers()
  })
})
