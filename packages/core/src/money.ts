/**
 * Money (spec 6.1, 11.1).
 *
 * Amounts are integer minor units plus an ISO 4217 code. There is no float
 * anywhere in this file and there must never be one anywhere in the money path:
 * `klopt/no-number-money` fails the build if a money-shaped field is typed
 * `number`.
 *
 * `Money` is the in-process representation. `MoneyWire` is the single wire
 * format for every boundary — REST, server functions, MCP, CLI, webhooks —
 * because TanStack Start serialises server function results automatically and
 * `bigint` has no JSON representation.
 */

/** ISO 4217 alphabetic code. Not validated here; the entity's currency list owns that. */
export type CurrencyCode = string

/** An exact amount of money. `minorUnits` is signed; negative is a credit balance. */
export interface Money {
  readonly minorUnits: bigint
  readonly currency: CurrencyCode
}

/**
 * The one money wire format. A decimal string, never a number, so that a JSON
 * parser on the other side cannot quietly round it.
 */
export interface MoneyWire {
  readonly amount: string
  readonly currency: CurrencyCode
}

/**
 * Minor-unit exponents that differ from the default of 2. Kept minimal on
 * purpose: this is scaffolding for the boundary codec, not a currency registry.
 * A real one arrives with the ledger in M0.
 */
const EXPONENTS: ReadonlyMap<string, number> = new Map([
  ['JPY', 0],
  ['KRW', 0],
  ['ISK', 0],
  ['BHD', 3],
  ['KWD', 3],
  ['TND', 3],
])

const DEFAULT_EXPONENT = 2

export function minorUnitExponent(currency: CurrencyCode): number {
  return EXPONENTS.get(currency.toUpperCase()) ?? DEFAULT_EXPONENT
}

export function money(minorUnits: bigint, currency: CurrencyCode): Money {
  return { minorUnits, currency }
}

/** Thrown when a wire value cannot be represented exactly. Never rounds silently. */
export class MoneyFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyFormatError'
  }
}

export function toWire(value: Money): MoneyWire {
  const exponent = minorUnitExponent(value.currency)
  const negative = value.minorUnits < 0n
  const digits = (negative ? -value.minorUnits : value.minorUnits).toString()

  let amount: string
  if (exponent === 0) {
    amount = digits
  } else {
    const padded = digits.padStart(exponent + 1, '0')
    const cut = padded.length - exponent
    amount = `${padded.slice(0, cut)}.${padded.slice(cut)}`
  }

  return { amount: negative ? `-${amount}` : amount, currency: value.currency }
}

const WIRE_PATTERN = /^-?\d+(\.\d+)?$/

export function fromWire(wire: MoneyWire): Money {
  const { amount, currency } = wire

  if (!WIRE_PATTERN.test(amount)) {
    throw new MoneyFormatError(`Not a decimal amount: ${JSON.stringify(amount)}`)
  }

  const negative = amount.startsWith('-')
  const unsigned = negative ? amount.slice(1) : amount
  const [whole = '', fraction = ''] = unsigned.split('.')
  const exponent = minorUnitExponent(currency)

  if (fraction.length > exponent) {
    // Rounding here would be a rounding difference with no destination account
    // (spec 6.1). The caller has to decide, so this is an error.
    throw new MoneyFormatError(
      `${amount} has more precision than ${currency} allows (${String(exponent)} minor digits).`,
    )
  }

  const minorUnits = BigInt(whole + fraction.padEnd(exponent, '0'))
  return { minorUnits: negative ? -minorUnits : minorUnits, currency }
}
