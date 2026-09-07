/**
 * Checking a counterparty's VAT number, as a port (spec 7.2).
 *
 * "Validate counterparty VAT numbers against VIES, cache results with a
 * timestamp, and store the validation proof. Store what VIES said and when,
 * because that is your evidence for applying the zero rate."
 *
 * The last clause is the whole reason this is a port with a record rather than
 * a boolean function. Zero-rating an intra-community supply is a claim, and the
 * thing that defends the claim in an audit is that you asked the Commission's
 * register at the time and it said yes. A `true` that was not written down
 * defends nothing.
 *
 * Two things follow from spec 8's rules for adapters:
 *
 *  - **Every request and response is recorded**, valid or not, reachable or
 *    not. A `VatNumberCheck` is written even when the service is down, with
 *    `outcome: 'unavailable'`, because "we could not ask" is a different fact
 *    from "we did not ask" and only one of them is somebody's fault.
 *  - **A failing adapter never blocks bookkeeping.** An unreachable VIES stops
 *    nobody from invoicing. It stops the ICP opgaaf from being *filed*, which
 *    is a different and correct thing.
 *
 * ## The consultation number
 *
 * VIES returns a `requestIdentifier` — the consultation number — only when the
 * caller identifies itself with its own member state and VAT number. That
 * identifier is the proof; a check made anonymously returns a valid/invalid
 * answer and nothing you can show anybody. So the requester's own VAT number is
 * a required part of the request rather than optional configuration, and an
 * entity that has not filled in its VAT number cannot obtain proof.
 */

export type VatNumberOutcome = 'valid' | 'invalid' | 'unavailable'

export interface VatNumberCheckRequest {
  /** The counterparty, e.g. `DE123456789`. Country prefix included. */
  readonly vatNumber: string
  /**
   * The asking entity's own VAT number. Without it VIES returns no consultation
   * number, and without that there is no proof.
   */
  readonly requesterVatNumber: string | null
}

export interface VatNumberCheck {
  readonly vatNumber: string
  readonly countryCode: string
  readonly outcome: VatNumberOutcome
  /** As registered. Blank for many member states, which is normal. */
  readonly name: string | null
  readonly address: string | null
  /** VIES's own request date, not ours. */
  readonly requestDate: string | null
  /** The consultation number. This is the proof; null when asked anonymously. */
  readonly requestIdentifier: string | null
  /** When we asked, ISO 8601. */
  readonly checkedAt: string
  /** Which service answered, for the evidence chain. */
  readonly source: string
  /** The response, verbatim. Stored rather than parsed away. */
  readonly raw: string
  /** Why it was unavailable, when it was. */
  readonly error: string | null
}

export interface VatNumberValidator {
  readonly name: string
  check(request: VatNumberCheckRequest): Promise<VatNumberCheck>
}

/**
 * The shape of an EU VAT number, per member state.
 *
 * Checked before the network call, for two reasons: a typo should not become a
 * stored "invalid" that looks like the counterparty's fault, and VIES rate
 * limits are real.
 */
const PATTERNS: Readonly<Record<string, RegExp>> = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  FR: /^[A-Z0-9]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^(\d{7}[A-W][A-IW]?|[A-W]\d{7}[A-W])$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{12}$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
  // Greece files as EL and Northern Ireland as XI; both are in VIES.
  XI: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
}

export interface ParsedVatNumber {
  readonly countryCode: string
  readonly number: string
  readonly normalised: string
}

/** Uppercased with spaces, dots and hyphens removed. What VIES expects. */
export function normaliseVatNumber(value: string): string {
  return value.toUpperCase().replace(/[\s.\-/]/g, '')
}

/**
 * Split a VAT number into its member state and its number, or `null` if it is
 * not the shape that member state uses.
 */
export function parseVatNumber(value: string): ParsedVatNumber | null {
  const normalised = normaliseVatNumber(value)
  const countryCode = normalised.slice(0, 2)
  const number = normalised.slice(2)
  const pattern = PATTERNS[countryCode]
  if (pattern === undefined || !pattern.test(number)) return null
  return { countryCode, number, normalised }
}

/** Whether this member state is in VIES at all. */
export function isEuVatCountry(countryCode: string): boolean {
  return Object.hasOwn(PATTERNS, countryCode.toUpperCase())
}
