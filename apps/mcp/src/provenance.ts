/**
 * What every answer carries besides the answer (spec 10.3).
 *
 * "Provenance is mandatory. Every result carries entity, period, currency and
 * the ids behind any number, so an agent can cite rather than paraphrase. A
 * number without a drill-down path is how an agent ends up confidently wrong
 * in a board pack."
 *
 * So this is not decoration on the response shape. A figure that arrives
 * without the entity it belongs to, the period it covers and the route it came
 * from is a figure an agent will happily attribute to the wrong company, the
 * wrong quarter, or a report that has since changed. The envelope makes that
 * hard to do by accident, because there is nowhere to put a bare number.
 */

export interface Period {
  readonly fiscalYear?: string
  readonly fromPeriod?: number
  readonly toPeriod?: number
  readonly from?: string
  readonly to?: string
  readonly asOf?: string
}

/**
 * A money amount, as a decimal string, from the API's minor units.
 *
 * The API answers money as minor units in a string — `"147425980"` — which is
 * unambiguous to a program that knows the convention and catastrophic to one
 * that does not. An agent shown `"debit": "147425980"` beside
 * `"currency": "EUR"` will report a hundred and forty-seven million euro. The
 * real figure is €1.474.259,80, and nothing in the payload contradicts the
 * wrong reading.
 *
 * That is exactly the failure spec 10.3 describes — "confidently wrong in a
 * board pack" — so amounts are converted once, here, at the boundary where
 * this server hands numbers to something that reasons in natural language.
 * `provenance.amounts` then says what unit they are in, so the convention is
 * stated rather than assumed.
 */
export function money(minorUnits: string | number | bigint): string {
  const raw = typeof minorUnits === 'string' ? minorUnits.trim() : String(minorUnits)
  if (!/^-?\d+$/.test(raw)) {
    // Not minor units. Returned untouched rather than mangled: a value this
    // does not recognise is one to pass through visibly, not to reformat into
    // something that looks right.
    return raw
  }

  const negative = raw.startsWith('-')
  const digits = (negative ? raw.slice(1) : raw).padStart(3, '0')
  const cut = digits.length - 2
  return `${negative ? '-' : ''}${digits.slice(0, cut)}.${digits.slice(cut)}`
}

export interface Provenance {
  readonly entity: { readonly id: string; readonly name: string }
  readonly currency: string
  readonly period?: Period
  /**
   * How to read the numbers. Stated, never assumed — see `money`.
   */
  readonly amounts: { readonly unit: 'decimal'; readonly note: string }
  /** When this was read. A report is a statement about a moment. */
  readonly readAt: string
  /**
   * The API routes behind it, so the same question can be asked again without
   * this server — and so a human can check the agent's homework.
   */
  readonly sources: readonly string[]
}

export interface Answer<T> {
  readonly provenance: Provenance
  readonly data: T
  /** Present only when something was left out. See `summarise`. */
  readonly truncated?: Truncation
}

export interface Truncation {
  readonly shown: number
  // `totalCount`, not `total`: the money lint is right that a bare `total`
  // typed `number` is almost always an amount, and this is a row count.
  readonly totalCount: number
  /** How to get the rest, in words the agent can act on. */
  readonly more: string
}

/**
 * Cut a list down before it reaches a context window.
 *
 * "Results are paginated and summarised by default, with an explicit expand.
 * Never let a tool dump a full ledger into a context window."
 *
 * The truncation is reported rather than silent, and it says how to get the
 * rest. An agent that does not know a list was cut will reason about the part
 * it can see as though it were the whole — which on a debtors list means
 * confidently naming the largest debtor from the first twenty-five rows.
 */
export const DEFAULT_LIMIT = 25
export const MAX_LIMIT = 200

export function summarise<T>(
  rows: readonly T[],
  limit: number = DEFAULT_LIMIT,
): { readonly rows: readonly T[]; readonly truncated?: Truncation } {
  const capped = Math.min(Math.max(1, limit), MAX_LIMIT)
  if (rows.length <= capped) return { rows }

  return {
    rows: rows.slice(0, capped),
    truncated: {
      shown: capped,
      totalCount: rows.length,
      more:
        capped >= MAX_LIMIT
          ? `Showing ${String(capped)} of ${String(rows.length)}, which is the most this tool will return at once. Narrow the question rather than asking for more.`
          : `Showing ${String(capped)} of ${String(rows.length)}. Ask again with limit up to ${String(MAX_LIMIT)}, or narrow the question.`,
    },
  }
}

/** The envelope. Nothing leaves a tool without one. */
export function answer<T>(provenance: Provenance, data: T, truncated?: Truncation): Answer<T> {
  return truncated === undefined ? { provenance, data } : { provenance, data, truncated }
}
