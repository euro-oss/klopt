/**
 * ECB daily reference rates (issue #42 / PM #55).
 *
 * Fetches the euro foreign exchange reference rates XML and parses Cube rows
 * into `{ currency, rateDate, rate }` for the cache. The product never depends
 * on the ECB being up for a date that is already cached.
 *
 * Feeds:
 * - 90-day: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml
 * - full history: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml
 *   (used when the document date is older than ~90 days)
 * - daily: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
 */

export interface ParsedEcbRate {
  readonly currency: string
  readonly rateDate: string
  readonly rate: string
}

const DEFAULT_HIST_90D_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml'
const DEFAULT_HIST_FULL_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml'
const DEFAULT_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

/** Prefer the full history file when the document is older than this many days. */
export const ECB_HIST_FULL_AFTER_DAYS = 90

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

/**
 * Published ECB quote (foreign units per 1 EUR) → EUR per 1 foreign unit, the
 * shape `journal_lines.exchange_rate` expects when the books are in EUR.
 *
 * Uses integer reciprocal maths (no IEEE float) so the money path stays off
 * `number` for the rate itself. Precision is 12 decimal places.
 */
export function eurPerForeign(published: string): string {
  const trimmed = published.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`ECB rate is not a positive number: ${published}`)
  }
  const [whole = '0', fraction = ''] = trimmed.split('.')
  const scaled = BigInt(whole + fraction)
  if (scaled <= 0n) {
    throw new Error(`ECB rate is not a positive number: ${published}`)
  }
  const scale = 10n ** BigInt(fraction.length)
  // 1 / (scaled/scale) = scale/scaled, emit with 12 decimals via fixed-point.
  const outScale = 10n ** 12n
  const reciprocal = (scale * outScale) / scaled
  const wholeOut = reciprocal / outScale
  const fracOut = (reciprocal % outScale).toString().padStart(12, '0')
  const trimmedFrac = fracOut.replace(/0+$/, '')
  return trimmedFrac === '' ? wholeOut.toString() : `${wholeOut.toString()}.${trimmedFrac}`
}

export interface FetchEcbRatesOptions {
  /** Override the 90-day history URL. */
  readonly hist90dUrl?: string
  /** Override the full-history URL (eurofxref-hist.xml). */
  readonly histFullUrl?: string
  readonly dailyUrl?: string
  /**
   * When true, also fetch the multi-year history file. Use for document dates
   * older than ~90 days (see {@link ECB_HIST_FULL_AFTER_DAYS}).
   */
  readonly includeFullHistory?: boolean
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
  const urls: string[] = [
    options.hist90dUrl ?? DEFAULT_HIST_90D_URL,
    options.dailyUrl ?? DEFAULT_DAILY_URL,
  ]
  if (options.includeFullHistory === true) {
    urls.unshift(options.histFullUrl ?? DEFAULT_HIST_FULL_URL)
  }
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
