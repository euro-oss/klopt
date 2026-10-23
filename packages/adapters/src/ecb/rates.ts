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
 *
 * Full-history XML is multi-megabyte. Callers must pass `currencies` and a
 * date window so we never materialise ~200k inverted rows in a web request.
 */

export interface ParsedEcbRate {
  readonly currency: string
  readonly rateDate: string
  readonly rate: string
}

export interface ParseEcbEurofxrefOptions {
  /** When set, only these ISO codes are kept (matched case-insensitively). */
  readonly currencies?: readonly string[]
  /** Inclusive lower bound `YYYY-MM-DD`. */
  readonly dateFrom?: string
  /** Inclusive upper bound `YYYY-MM-DD`. */
  readonly dateTo?: string
}

const DEFAULT_HIST_90D_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml'
const DEFAULT_HIST_FULL_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml'
const DEFAULT_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

/** Prefer the full history file when the document is older than this many days. */
export const ECB_HIST_FULL_AFTER_DAYS = 90

/** Abort every ECB HTTP fetch after this many milliseconds. */
export const ECB_FETCH_TIMEOUT_MS = 15_000

/** Refuse ECB response bodies larger than this (the full hist feed is ~8 MB). */
export const ECB_MAX_RESPONSE_BYTES = 20 * 1024 * 1024

/**
 * Parse the ECB eurofxref XML into flat rate rows.
 *
 * Tolerates both the daily and historical Cube nesting. Rates are "EUR per 1
 * foreign" as published (e.g. USD 1.08 means 1 EUR = 1.08 USD). For posting we
 * need foreign→functional (EUR per 1 USD), so callers invert when the
 * functional currency is EUR: `rate = 1 / published`.
 *
 * Optional filters drop non-matching Cube rows while scanning so a multi-year
 * feed never builds an intermediate structure for the whole file.
 */
export function parseEcbEurofxrefXml(
  xml: string,
  options: ParseEcbEurofxrefOptions = {},
): readonly ParsedEcbRate[] {
  const currencyAllow =
    options.currencies === undefined || options.currencies.length === 0
      ? null
      : new Set(options.currencies.map((code) => code.toUpperCase()))
  const dateFrom = options.dateFrom
  const dateTo = options.dateTo

  const rows: ParsedEcbRate[] = []
  // <Cube time="2026-10-16"><Cube currency="USD" rate="1.0856"/>...</Cube>
  const dayBlocks = xml.matchAll(/<Cube\s+time="(\d{4}-\d{2}-\d{2})"\s*>([\s\S]*?)<\/Cube>/g)
  for (const block of dayBlocks) {
    const rateDate = block[1]!
    if (dateFrom !== undefined && rateDate < dateFrom) continue
    if (dateTo !== undefined && rateDate > dateTo) continue
    const body = block[2]!
    for (const rateMatch of body.matchAll(
      /<Cube\s+currency="([A-Z]{3})"\s+rate="([0-9.]+)"\s*\/>/g,
    )) {
      const currency = rateMatch[1]!
      if (currencyAllow !== null && !currencyAllow.has(currency)) continue
      rows.push({
        currency,
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
  /**
   * Restrict stored rows to these currencies. Required for full-history
   * fetches so memory stays bounded independent of feed length.
   */
  readonly currencies?: readonly string[]
  /** Inclusive lower bound `YYYY-MM-DD` for kept Cube days. */
  readonly dateFrom?: string
  /** Inclusive upper bound `YYYY-MM-DD` for kept Cube days. */
  readonly dateTo?: string
  readonly fetch?: typeof globalThis.fetch
  /** Override {@link ECB_FETCH_TIMEOUT_MS}. */
  readonly timeoutMs?: number
  /** Override {@link ECB_MAX_RESPONSE_BYTES}. */
  readonly maxResponseBytes?: number
}

async function readResponseTextCapped(response: Response, maxBytes: number): Promise<string> {
  const lengthHeader = response.headers.get('content-length')
  if (lengthHeader !== null && lengthHeader !== '') {
    const declared = Number(lengthHeader)
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`ECB rate feed exceeds ${String(maxBytes)} bytes`)
    }
  }

  if (response.body === null) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`ECB rate feed exceeds ${String(maxBytes)} bytes`)
    }
    return text
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value === undefined) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`ECB rate feed exceeds ${String(maxBytes)} bytes`)
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(merged)
}

async function fetchOneFeed(
  fetchFn: typeof globalThis.fetch,
  url: string,
  byKey: Map<string, ParsedEcbRate>,
  options: {
    readonly required: boolean
    readonly timeoutMs: number
    readonly maxResponseBytes: number
    readonly filter: ParseEcbEurofxrefOptions
  },
): Promise<void> {
  let response: Response
  try {
    response = await fetchFn(url, {
      headers: { Accept: 'application/xml,text/xml,*/*' },
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch (error: unknown) {
    if (!options.required) return
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`ECB rate feed request failed for ${url}: ${message}`, { cause: error })
  }
  if (!response.ok) {
    if (options.required) {
      throw new Error(`ECB rate feed returned HTTP ${String(response.status)} for ${url}`)
    }
    return
  }

  let xml: string
  try {
    xml = await readResponseTextCapped(response, options.maxResponseBytes)
  } catch (error: unknown) {
    if (!options.required) return
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`ECB rate feed body failed for ${url}: ${message}`, { cause: error })
  }

  let published: readonly ParsedEcbRate[]
  try {
    published = parseEcbEurofxrefXml(xml, options.filter)
  } catch (error: unknown) {
    if (!options.required) return
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`ECB rate feed parse failed for ${url}: ${message}`, { cause: error })
  }

  for (const row of published) {
    byKey.set(`${row.currency}:${row.rateDate}`, {
      currency: row.currency,
      rateDate: row.rateDate,
      rate: eurPerForeign(row.rate),
    })
  }
}

/**
 * Fetch and parse ECB rates, returning rows already inverted to EUR-per-foreign
 * for storage in `ecb_reference_rates`.
 *
 * The 90-day + daily feeds are required. The full multi-year history file is
 * best-effort: a 401/5xx there must not block a look-up that the 90-day feed
 * already covers (PM #55 / CI egress).
 *
 * Pass `currencies` + `dateFrom`/`dateTo` whenever `includeFullHistory` is set
 * so only the lookback window for the document is materialised.
 */
export async function fetchEcbReferenceRates(
  options: FetchEcbRatesOptions = {},
): Promise<readonly ParsedEcbRate[]> {
  const fetchFn = options.fetch ?? globalThis.fetch
  const byKey = new Map<string, ParsedEcbRate>()
  const timeoutMs = options.timeoutMs ?? ECB_FETCH_TIMEOUT_MS
  const maxResponseBytes = options.maxResponseBytes ?? ECB_MAX_RESPONSE_BYTES
  const filter: ParseEcbEurofxrefOptions = {
    ...(options.currencies === undefined ? {} : { currencies: options.currencies }),
    ...(options.dateFrom === undefined ? {} : { dateFrom: options.dateFrom }),
    ...(options.dateTo === undefined ? {} : { dateTo: options.dateTo }),
  }
  const feedOptions = { timeoutMs, maxResponseBytes, filter }

  await fetchOneFeed(fetchFn, options.hist90dUrl ?? DEFAULT_HIST_90D_URL, byKey, {
    required: true,
    ...feedOptions,
  })
  await fetchOneFeed(fetchFn, options.dailyUrl ?? DEFAULT_DAILY_URL, byKey, {
    required: true,
    ...feedOptions,
  })
  if (options.includeFullHistory === true) {
    await fetchOneFeed(fetchFn, options.histFullUrl ?? DEFAULT_HIST_FULL_URL, byKey, {
      required: false,
      ...feedOptions,
    })
  }

  return [...byKey.values()].sort(
    (left, right) =>
      left.rateDate.localeCompare(right.rateDate) || left.currency.localeCompare(right.currency),
  )
}
