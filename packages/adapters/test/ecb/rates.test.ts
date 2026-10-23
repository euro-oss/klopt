import { describe, expect, it } from 'vitest'
import {
  ECB_FETCH_TIMEOUT_MS,
  ECB_MAX_RESPONSE_BYTES,
  eurPerForeign,
  fetchEcbReferenceRates,
  parseEcbEurofxrefXml,
} from '../../src/ecb/index.js'

const SAMPLE = `<?xml version="1.0"?>
<gesmes:Envelope>
  <Cube>
    <Cube time="2026-10-16">
      <Cube currency="USD" rate="1.0856"/>
      <Cube currency="GBP" rate="0.8621"/>
    </Cube>
    <Cube time="2026-10-15">
      <Cube currency="USD" rate="1.0840"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`

const CURRENCIES = [
  'USD',
  'JPY',
  'BGN',
  'CZK',
  'DKK',
  'GBP',
  'HUF',
  'PLN',
  'RON',
  'SEK',
  'CHF',
  'ISK',
  'NOK',
  'TRY',
  'AUD',
  'BRL',
  'CAD',
  'CNY',
  'HKD',
  'IDR',
  'ILS',
  'INR',
  'KRW',
  'MXN',
  'MYR',
  'NZD',
  'PHP',
  'SGD',
  'THB',
  'ZAR',
] as const

/** Synthetic eurofxref-hist shaped feed: ~7_000 days × ~30 currencies. */
function buildSyntheticFullHistoryXml(options: {
  readonly dayCount: number
  readonly startDate: string
}): string {
  const start = Date.UTC(
    Number(options.startDate.slice(0, 4)),
    Number(options.startDate.slice(5, 7)) - 1,
    Number(options.startDate.slice(8, 10)),
  )
  const days: string[] = []
  for (let index = 0; index < options.dayCount; index += 1) {
    const iso = new Date(start + index * 86_400_000).toISOString().slice(0, 10)
    const cubes = CURRENCIES.map(
      (currency, currencyIndex) =>
        `<Cube currency="${currency}" rate="${(1.05 + currencyIndex * 0.01).toFixed(4)}"/>`,
    ).join('')
    days.push(`<Cube time="${iso}">${cubes}</Cube>`)
  }
  return `<?xml version="1.0"?><gesmes:Envelope><Cube>${days.join('')}</Cube></gesmes:Envelope>`
}

function okXmlResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: { 'content-type': 'text/xml', 'content-length': String(Buffer.byteLength(xml)) },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  return new DOMException('The operation was aborted.', 'AbortError')
}

describe('parseEcbEurofxrefXml', () => {
  it('reads Cube time and currency rows', () => {
    const rows = parseEcbEurofxrefXml(SAMPLE)
    expect(rows).toEqual([
      { currency: 'USD', rateDate: '2026-10-16', rate: '1.0856' },
      { currency: 'GBP', rateDate: '2026-10-16', rate: '0.8621' },
      { currency: 'USD', rateDate: '2026-10-15', rate: '1.0840' },
    ])
  })

  it('filters to the requested currency and date window while scanning', () => {
    const xml = buildSyntheticFullHistoryXml({ dayCount: 7_000, startDate: '2000-01-03' })
    const before = process.memoryUsage().heapUsed
    const rows = parseEcbEurofxrefXml(xml, {
      currencies: ['USD'],
      dateFrom: '2019-01-01',
      dateTo: '2019-01-15',
    })
    const after = process.memoryUsage().heapUsed
    expect(rows.every((row) => row.currency === 'USD')).toBe(true)
    expect(rows.every((row) => row.rateDate >= '2019-01-01' && row.rateDate <= '2019-01-15')).toBe(
      true,
    )
    // ~11 weekdays in the window — never tens of thousands of Cube rows.
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(20)
    // Heap delta must stay far below materialising ~210k inverted rows.
    expect(after - before).toBeLessThan(64 * 1024 * 1024)
  })
})

describe('eurPerForeign', () => {
  it('inverts the published quote for journal_lines.exchange_rate without float maths', () => {
    const inverted = eurPerForeign('1.0856')
    expect(inverted).toMatch(/^\d+\.\d+$/)
    // 1/1.0856 ≈ 0.921149… — integer reciprocal at 12dp.
    expect(inverted.startsWith('0.921')).toBe(true)
    expect(Number(inverted)).toBeCloseTo(1 / 1.0856, 10)
  })
})

describe('fetchEcbReferenceRates', () => {
  it('keeps only the requested currency and window from a full-history feed', async () => {
    const histXml = buildSyntheticFullHistoryXml({ dayCount: 7_000, startDate: '2000-01-03' })
    const upserted: { currency: string; rateDate: string }[] = []
    const fetchMock: typeof fetch = (input) => {
      const url = requestUrl(input)
      if (url.includes('hist.xml') && !url.includes('90d')) {
        return Promise.resolve(okXmlResponse(histXml))
      }
      // Required 90d + daily can be empty for this assertion.
      return Promise.resolve(
        okXmlResponse(`<?xml version="1.0"?><gesmes:Envelope><Cube></Cube></gesmes:Envelope>`),
      )
    }
    const rows = await fetchEcbReferenceRates({
      includeFullHistory: true,
      currencies: ['USD'],
      dateFrom: '2019-01-08',
      dateTo: '2019-01-15',
      fetch: fetchMock,
    })
    for (const row of rows) upserted.push({ currency: row.currency, rateDate: row.rateDate })
    expect(upserted.every((row) => row.currency === 'USD')).toBe(true)
    expect(
      upserted.every((row) => row.rateDate >= '2019-01-08' && row.rateDate <= '2019-01-15'),
    ).toBe(true)
    expect(upserted.length).toBeLessThan(20)
  })

  it('times out a hanging fetch instead of hanging the caller', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (signal == null) return
        if (signal.aborted) {
          reject(abortError(signal.reason))
          return
        }
        signal.addEventListener('abort', () => {
          reject(abortError(signal.reason))
        })
      })
    await expect(
      fetchEcbReferenceRates({
        fetch: hanging,
        timeoutMs: 50,
        hist90dUrl: 'https://ecb.test/90d.xml',
        dailyUrl: 'https://ecb.test/daily.xml',
      }),
    ).rejects.toThrow(/ECB rate feed request failed/)
  })

  it('exposes a 15s timeout and 20 MB body cap for production fetches', () => {
    expect(ECB_FETCH_TIMEOUT_MS).toBe(15_000)
    expect(ECB_MAX_RESPONSE_BYTES).toBe(20 * 1024 * 1024)
  })

  it('refuses an oversized response body', async () => {
    const oversized = 'x'.repeat(1_024)
    const fetchMock: typeof fetch = () =>
      Promise.resolve(
        new Response(oversized, {
          status: 200,
          headers: { 'content-type': 'text/xml', 'content-length': String(oversized.length) },
        }),
      )
    await expect(
      fetchEcbReferenceRates({
        fetch: fetchMock,
        maxResponseBytes: 512,
        hist90dUrl: 'https://ecb.test/90d.xml',
        dailyUrl: 'https://ecb.test/daily.xml',
      }),
    ).rejects.toThrow(/exceeds/)
  })

  it('passes AbortSignal.timeout on every ECB fetch', async () => {
    const signals: AbortSignal[] = []
    const fetchMock: typeof fetch = (_input, init) => {
      const signal = init?.signal
      if (signal != null) signals.push(signal)
      return Promise.resolve(okXmlResponse(SAMPLE))
    }
    await fetchEcbReferenceRates({
      fetch: fetchMock,
      includeFullHistory: true,
      currencies: ['USD'],
      dateFrom: '2026-10-15',
      dateTo: '2026-10-16',
    })
    expect(signals.length).toBeGreaterThanOrEqual(3)
    expect(signals.every((signal) => typeof signal.aborted === 'boolean')).toBe(true)
  })
})
