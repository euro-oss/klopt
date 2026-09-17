/**
 * Just enough DER to talk to a timestamp authority (RFC 3161).
 *
 * Not a general ASN.1 library, and deliberately so: the shapes this needs are
 * a handful of SEQUENCEs, INTEGERs, OCTET STRINGs and one GeneralizedTime, and
 * a general decoder would be a much larger thing to get right for no gain. It
 * refuses what it does not understand rather than guessing.
 *
 * Two rules it does enforce, because they are where hand-rolled DER goes
 * wrong:
 *
 *   - **Lengths are minimal.** DER has exactly one encoding for each length,
 *     and accepting a non-minimal one means two byte strings can mean the same
 *     thing — which in a signed structure is how a signature covers something
 *     other than what was read.
 *   - **INTEGERs are two's complement.** A leading bit of 1 needs a 0x00 in
 *     front or the value is negative. A nonce that silently went negative
 *     would not match the one that comes back.
 */

export class DerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DerError'
  }
}

export const TAG = {
  boolean: 0x01,
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  null: 0x05,
  objectIdentifier: 0x06,
  sequence: 0x30,
  set: 0x31,
  generalizedTime: 0x18,
} as const

function lengthBytes(length: number): number[] {
  if (length < 0x80) return [length]

  const bytes: number[] = []
  let remaining = length
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining >>>= 8
  }
  return [0x80 | bytes.length, ...bytes]
}

/** A tag, its length, and its contents. The whole of the writer. */
export function encode(tag: number, contents: readonly number[] | Uint8Array): Uint8Array {
  const body = [...contents]
  return Uint8Array.from([tag, ...lengthBytes(body.length), ...body])
}

export function encodeSequence(...parts: readonly Uint8Array[]): Uint8Array {
  return encode(
    TAG.sequence,
    parts.flatMap((part) => [...part]),
  )
}

/** An unsigned integer, given as bytes, in DER's two's-complement form. */
export function encodeInteger(value: readonly number[] | Uint8Array): Uint8Array {
  let bytes = [...value]
  while (bytes.length > 1 && bytes[0] === 0x00 && (bytes[1]! & 0x80) === 0) bytes = bytes.slice(1)
  if (bytes.length === 0) bytes = [0x00]
  // A leading bit of 1 would read as negative.
  if ((bytes[0]! & 0x80) !== 0) bytes.unshift(0x00)
  return encode(TAG.integer, bytes)
}

export function encodeSmallInteger(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DerError(`${String(value)} is not a non-negative integer.`)
  }
  const bytes: number[] = []
  let remaining = value
  do {
    bytes.unshift(remaining & 0xff)
    remaining = Math.floor(remaining / 256)
  } while (remaining > 0)
  return encodeInteger(bytes)
}

export function encodeBoolean(value: boolean): Uint8Array {
  // DER says TRUE is 0xff, not "any non-zero". BER allows the latter.
  return encode(TAG.boolean, [value ? 0xff : 0x00])
}

export function encodeNull(): Uint8Array {
  return encode(TAG.null, [])
}

/** A dotted OID, e.g. `2.16.840.1.101.3.4.2.1`. */
export function encodeObjectIdentifier(oid: string): Uint8Array {
  const parts = oid.split('.').map(Number)
  if (parts.length < 2 || parts.some((part) => !Number.isSafeInteger(part) || part < 0)) {
    throw new DerError(`${oid} is not an object identifier.`)
  }

  // The first two arcs share one byte, which is the one thing about OID
  // encoding nobody remembers.
  const body: number[] = [parts[0]! * 40 + parts[1]!]
  for (const part of parts.slice(2)) {
    const base128: number[] = []
    let remaining = part
    do {
      base128.unshift(remaining & 0x7f)
      remaining = Math.floor(remaining / 128)
    } while (remaining > 0)
    for (let index = 0; index < base128.length - 1; index += 1) base128[index]! |= 0x80
    body.push(...base128)
  }
  return encode(TAG.objectIdentifier, body)
}

export function encodeOctetString(bytes: Uint8Array): Uint8Array {
  return encode(TAG.octetString, bytes)
}

/** One TLV, read out of a buffer. */
export interface DerNode {
  readonly tag: number
  readonly contents: Uint8Array
  /** Where the next TLV begins. */
  readonly end: number
}

export function readNode(bytes: Uint8Array, offset = 0): DerNode {
  if (offset + 2 > bytes.length) throw new DerError('Truncated before a tag and a length.')
  const tag = bytes[offset]!
  if ((tag & 0x1f) === 0x1f) throw new DerError('High-tag-number form is not supported here.')

  const first = bytes[offset + 1]!
  let length: number
  let headerLength: number

  if (first < 0x80) {
    length = first
    headerLength = 2
  } else {
    const count = first & 0x7f
    if (count === 0) throw new DerError('Indefinite length is not DER.')
    if (count > 4) throw new DerError('A length this large is not something we produce or read.')
    length = 0
    for (let index = 0; index < count; index += 1) {
      const byte = bytes[offset + 2 + index]
      if (byte === undefined) throw new DerError('Truncated inside a length.')
      length = length * 256 + byte
    }
    if (length < 0x80) throw new DerError('Non-minimal length: DER has one encoding per length.')
    headerLength = 2 + count
  }

  const start = offset + headerLength
  const end = start + length
  if (end > bytes.length) throw new DerError('Truncated inside a value.')
  return { tag, contents: bytes.subarray(start, end), end }
}

/** Every child of a constructed node, in order. */
export function readChildren(contents: Uint8Array): readonly DerNode[] {
  const children: DerNode[] = []
  let offset = 0
  while (offset < contents.length) {
    const node = readNode(contents, offset)
    children.push(node)
    offset = node.end
  }
  return children
}

export function expect(node: DerNode | undefined, tag: number, what: string): DerNode {
  if (node === undefined) throw new DerError(`Missing ${what}.`)
  if (node.tag !== tag) {
    throw new DerError(
      `Expected ${what} to be tag 0x${tag.toString(16)}, got 0x${node.tag.toString(16)}.`,
    )
  }
  return node
}

export function readInteger(node: DerNode): bigint {
  if (node.contents.length === 0) throw new DerError('An INTEGER with no bytes.')
  let value = 0n
  for (const byte of node.contents) value = (value << 8n) | BigInt(byte)
  // Every integer this reads is a serial number or a nonce, both unsigned.
  return value
}

export function readObjectIdentifier(node: DerNode): string {
  const bytes = node.contents
  if (bytes.length === 0) throw new DerError('An OID with no bytes.')
  const first = bytes[0]!
  const parts: number[] = [Math.floor(first / 40), first % 40]

  let value = 0
  for (const byte of bytes.subarray(1)) {
    value = value * 128 + (byte & 0x7f)
    if ((byte & 0x80) === 0) {
      parts.push(value)
      value = 0
    }
  }
  return parts.join('.')
}

/**
 * `20260917122619Z` as an ISO 8601 instant.
 *
 * RFC 3161 requires UTC with the trailing Z, and fractional seconds are
 * allowed. Anything else is refused rather than interpreted in local time,
 * which is how a timestamp ends up an hour out twice a year.
 */
export function readGeneralizedTime(node: DerNode): string {
  const text = new TextDecoder().decode(node.contents)
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/.exec(text)
  if (match === null) throw new DerError(`${text} is not a UTC GeneralizedTime.`)

  const [, year, month, day, hour, minute, second, fraction = ''] = match
  return `${year!}-${month!}-${day!}T${hour!}:${minute!}:${second!}${fraction}Z`
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function fromHex(hex: string): Uint8Array {
  if (!/^([0-9a-fA-F]{2})*$/.test(hex)) throw new DerError('That is not hex.')
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
}
