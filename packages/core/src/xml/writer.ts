/**
 * Writing XML by hand, indented.
 *
 * Three generators need this — XAF, UBL and the XBRL instance — and the third
 * one arriving is the reason it lives here instead of being copied a third
 * time. It stays deliberately small: no namespace bookkeeping, no schema
 * awareness, no pretty-printing options.
 *
 * Hand-written rather than through an XML library, for reasons that hold for
 * all three formats. XSD sequences are ordered, so the order of the calls *is*
 * the contract, and having it visible as one readable list is worth more than
 * the generality a builder would buy. And every amount has to become a decimal
 * string from a bigint without passing through a float — a generic serialiser
 * is exactly where that guarantee gets lost.
 *
 * Absence is marked by omission in every one of the three formats, so `leaf`
 * writes nothing for `null` rather than writing an empty element. The two are
 * not the same thing to a validator.
 */

const INDENT = '  '

/**
 * XML 1.0 forbids most control characters outright — they cannot be escaped,
 * only dropped. Tab, newline and carriage return are the exceptions.
 */
// The control characters are the point of this rule, so the lint rule that
// objects to them in a regex has nothing useful to say here.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export function escapeXml(value: string): string {
  return value
    .replace(FORBIDDEN_CONTROL_CHARACTERS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type XmlAttributes = Record<string, string | null>

function attributesOf(attributes: XmlAttributes): string {
  return Object.entries(attributes)
    .filter((pair): pair is [string, string] => pair[1] !== null)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('')
}

export class XmlWriter {
  private readonly parts: string[] = []
  private depth = 0

  open(name: string, attributes: XmlAttributes = {}): void {
    this.parts.push(`${INDENT.repeat(this.depth)}<${name}${attributesOf(attributes)}>\n`)
    this.depth += 1
  }

  close(name: string): void {
    this.depth -= 1
    this.parts.push(`${INDENT.repeat(this.depth)}</${name}>\n`)
  }

  /** Writes nothing when the value is null: absence is omission, not emptiness. */
  leaf(name: string, value: string | number | null, attributes: XmlAttributes = {}): void {
    if (value === null) return
    const text = typeof value === 'number' ? String(value) : value
    this.parts.push(
      `${INDENT.repeat(this.depth)}<${name}${attributesOf(attributes)}>${escapeXml(text)}</${name}>\n`,
    )
  }

  /** An element with attributes and no content, e.g. XBRL's `link:schemaRef`. */
  empty(name: string, attributes: XmlAttributes = {}): void {
    this.parts.push(`${INDENT.repeat(this.depth)}<${name}${attributesOf(attributes)}/>\n`)
  }

  toString(): string {
    return this.parts.join('')
  }
}

/**
 * Minor units to a decimal string, through integers only.
 *
 * Signed, and with a configurable exponent so a whole-euro format (the
 * BTW-aangifte) and a two-decimal one (everything else) come from the same code
 * rather than from two roundings.
 */
export function decimalString(minorUnits: bigint, exponent = 2): string {
  const negative = minorUnits < 0n
  const digits = (negative ? -minorUnits : minorUnits).toString().padStart(exponent + 1, '0')
  const whole = digits.slice(0, digits.length - exponent)
  const fraction = exponent === 0 ? '' : `.${digits.slice(digits.length - exponent)}`
  return `${negative ? '-' : ''}${whole}${fraction}`
}
