/**
 * ECB daily reference rates (issue #42).
 *
 * Fetches the euro foreign exchange reference rates XML and parses Cube rows
 * into `{ currency, rateDate, rate }` for the cache. The product never depends
 * on the ECB being up for a date that is already cached.
 *
 * Feed: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml
 * (90-day history — enough for import document dates without the multi-megabyte
 * full history file). Daily snapshot: eurofxref-daily.xml.
 */

export interface ParsedEcbRate {
  readonly currency: string
  readonly rateDate: string
  readonly rate: string
}

const DEFAULT_HIST_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml'
const DEFAULT_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

/**
 * Parse the ECB eurofxref XML into flat rate rows.
 *
 * Tolerates both the daily and historical Cube nesting. Rates are "EUR per 1
 * foreign" as published (e.g. USD 1.08 means 1 EUR = 1.08 USD). For posting we
 * need foreign→functional (EUR per 1 USD), so callers invert when the
 * functional currency is EUR: `rate = 1 / published`.
 */
export function parseEcbEurofxrefXml(xml: string): readonly ParsedEcbRate[] {
  const rows: ParsedEcbRate[] = []
  // <Cube time="2026-10-16"><Cube currency="USD" rate="1.0856"/>...</Cube>
  const dayBlocks = xml.matchAll(/<Cube\s+time="(\d{4}-\d{2}-\d{2})"\s*>([\s\S]*?)<\/Cube>/g) ?? []
  for (const block of dayBlocks) {
    const rateDate = block[1]!
    const body = block[2]!
    for (const rateMatch of body.matchAll(
      /<Cube\s+currency="([A-Z]{3})"\s+rate="([0-9.]+)"\s*\/>/g,
    )) {
      rows.push({
        currency: rateMatch[1]!,
        rateDate,
        rate: rateMatch[2]!,
      })
    }
  }
  return rows
}

function tidyRate(value: number): string {
  const fixed = value.toFixed(12)
  return fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
}

/**
 * Published ECB quote (foreign units per 1 EUR) → EUR per 1 foreign unit, the
 * shape `journal_lines.exchange_rate` expects when the books are in EUR.
 */
export function eurPerForeign(published: string): string {
  const value = Number(published)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`ECB rate is not a positive number: ${published}`)
  }
  return tidyRate(1 / value)
}

export interface FetchEcbRatesOptions {
  readonly histUrl?: string
  readonly dailyUrl?: string
  readonly fetch?: typeof globalThis.fetch
}

/**
 * Fetch and parse ECB rates, returning rows already inverted to EUR-per-foreign
 * for storage in `ecb_reference_rates`.
 */
export async function fetchEcbReferenceRates(
  options: FetchEcbRatesOptions = {},
): Promise<readonly ParsedEcbRate[]> {
  const fetchFn = options.fetch ?? globalThis.fetch
  const urls = [options.histUrl ?? DEFAULT_HIST_URL, options.dailyUrl ?? DEFAULT_DAILY_URL]
  const byKey = new Map<string, ParsedEcbRate>()

  for (const url of urls) {
    const response = await fetchFn(url, {
      headers: { Accept: 'application/xml,text/xml,*/*' },
    })
    if (!response.ok) {
      throw new Error(`ECB rate feed returned HTTP ${String(response.status)} for ${url}`)
    }
    const xml = await response.text()
    for (const row of parseEcbEurofxrefXml(xml)) {
      byKey.set(`${row.currency}:${row.rateDate}`, {
        currency: row.currency,
        rateDate: row.rateDate,
        rate: eurPerForeign(row.rate),
      })
    }
  }

  return [...byKey.values()].sort(
    (left, right) =>
      left.rateDate.localeCompare(right.rateDate) || left.currency.localeCompare(right.currency),
  )
}
