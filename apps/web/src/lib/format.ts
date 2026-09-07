/**
 * Formatting money for a Dutch bookkeeper.
 *
 * Amounts arrive from the API as integer minor units in a **string** and are
 * parsed to `bigint`. They are never `Number`-ed, not even for display: the
 * moment a figure passes through a float, the number on the screen and the
 * number in the ledger are two different things.
 */

const GROUP = '.'
const DECIMAL = ','

export interface MoneyFormat {
  /** Minus sign or parentheses. A setting, applied in one place (spec 11.3). */
  readonly negative: 'minus' | 'parentheses'
  readonly showZero: boolean
}

export const DEFAULT_MONEY_FORMAT: MoneyFormat = { negative: 'minus', showZero: true }

/** Integer division and string surgery only. No division by 100 in a float. */
export function formatMinorUnits(
  minorUnits: bigint,
  format: MoneyFormat = DEFAULT_MONEY_FORMAT,
): string {
  if (minorUnits === 0n && !format.showZero) return ''

  const negative = minorUnits < 0n
  const digits = (negative ? -minorUnits : minorUnits).toString().padStart(3, '0')
  const whole = digits.slice(0, -2)
  const cents = digits.slice(-2)

  let grouped = ''
  for (let index = 0; index < whole.length; index += 1) {
    if (index > 0 && (whole.length - index) % 3 === 0) grouped += GROUP
    grouped += whole[index]
  }

  const rendered = `${grouped}${DECIMAL}${cents}`
  if (!negative) return rendered
  return format.negative === 'parentheses' ? `(${rendered})` : `-${rendered}`
}

/**
 * Read what a bookkeeper actually typed.
 *
 * Dutch convention is `.` for grouping and `,` for decimals, but a numeric
 * keypad produces `.` and people mean the decimal point when they press it. So
 * neither character has a fixed meaning; position decides:
 *
 *   - Both present: the **later** one is the decimal separator.
 *   - One present, more than once: it is grouping. `1.234.567` is a million.
 *   - One present, once: decimal if it is followed by one or two digits,
 *     grouping otherwise. `1.234` is one thousand two hundred and thirty-four;
 *     `1.23` is one and twenty-three cents.
 *
 * Grouping is then validated — `1.2.3.4` is not a number anyone meant — and the
 * result is assembled with string surgery, never division.
 */
export function parseMinorUnits(input: string): bigint | null {
  const cleaned = input.trim().replace(/\s/g, '')
  if (cleaned === '') return null

  const negative = cleaned.startsWith('-') || (cleaned.startsWith('(') && cleaned.endsWith(')'))
  const unsigned = cleaned.replace(/^[-(]/, '').replace(/\)$/, '')
  if (unsigned === '' || !/^[\d.,]+$/.test(unsigned)) return null

  const lastComma = unsigned.lastIndexOf(',')
  const lastDot = unsigned.lastIndexOf('.')

  let decimalAt = -1
  if (lastComma >= 0 && lastDot >= 0) {
    decimalAt = Math.max(lastComma, lastDot)
  } else if (lastComma >= 0 || lastDot >= 0) {
    const only = lastComma >= 0 ? ',' : '.'
    const occurrences = unsigned.split(only).length - 1
    const trailing = unsigned.length - unsigned.lastIndexOf(only) - 1
    if (occurrences === 1 && trailing >= 1 && trailing <= 2) {
      decimalAt = unsigned.lastIndexOf(only)
    }
  }

  const wholePart = decimalAt === -1 ? unsigned : unsigned.slice(0, decimalAt)
  const fraction = decimalAt === -1 ? '' : unsigned.slice(decimalAt + 1)

  if (!/^\d{0,2}$/.test(fraction)) return null

  // Grouping, if any, must look like grouping: 1-3 digits, then groups of 3.
  const groups = wholePart.split(/[.,]/)
  if (groups.length > 1) {
    const [first, ...rest] = groups
    if (first === undefined || !/^\d{1,3}$/.test(first)) return null
    if (!rest.every((group) => /^\d{3}$/.test(group))) return null
  } else if (!/^\d+$/.test(groups[0] ?? '')) {
    return null
  }

  const whole = groups.join('')
  const value = BigInt(whole + fraction.padEnd(2, '0'))
  return negative ? -value : value
}

export function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  if (year === undefined || month === undefined || day === undefined) return iso
  return `${day}-${month}-${year}`
}

/** Half-up division of integers, sign-aware. The only rounding in this file. */
function divideRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n
  const a = numerator < 0n ? -numerator : numerator
  const b = denominator < 0n ? -denominator : denominator
  const rounded = (a * 2n + b) / (b * 2n)
  return negative ? -rounded : rounded
}

/**
 * A decimal string times minor units, as minor units.
 *
 * The same arithmetic `priceInvoice` does in `@klopt/core`, repeated here
 * because the browser cannot import that package — it is built on `node:fs`
 * and `node:crypto`. Repeated rather than approximated: a preview total that
 * disagrees with the posted one by a cent is worse than no preview, and
 * `Number(price) * quantity` disagrees for exactly the amounts people invoice.
 *
 * The server's answer is still the authoritative one, because it applies the
 * entity's per-invoice or per-line rounding policy and this cannot.
 */
export function multiplyByDecimal(minorUnits: bigint, decimal: string): bigint {
  const trimmed = decimal.trim()
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return 0n

  const negative = trimmed.startsWith('-')
  const unsigned = negative ? trimmed.slice(1) : trimmed
  const [whole = '0', fraction = ''] = unsigned.split('.')
  const scaled = BigInt(whole + fraction)
  const scale = 10n ** BigInt(fraction.length)

  const product = divideRound(minorUnits * scaled, scale)
  return negative ? -product : product
}

/** Minor units times a percentage given as a decimal string like `21.00`. */
export function percentOf(minorUnits: bigint, percent: string): bigint {
  return divideRound(multiplyByDecimal(minorUnits, percent), 100n)
}
