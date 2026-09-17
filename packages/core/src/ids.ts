import { randomBytes } from 'node:crypto'

/**
 * UUIDv7. Time-ordered, so primary keys cluster by creation time and B-tree
 * inserts stay at the right-hand edge of the index instead of scattering.
 *
 * Generated here rather than by Postgres: `uuidv7()` is a PostgreSQL 18
 * function and the supported floor is 16. Generating ids in the application
 * also means the caller knows an entry's id before it is inserted, which the
 * outbox and the audit log both need inside the same transaction.
 *
 * Layout (RFC 9562):
 *   48 bits  unix milliseconds, big-endian
 *    4 bits  version (7)
 *   12 bits  counter, for monotonicity inside a millisecond
 *    2 bits  variant (0b10)
 *   62 bits  random
 */

const MAX_COUNTER = 0xfff

let lastTimestamp = -1
let counter = 0

function nextCounter(timestamp: number): number {
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp
    // Seeded low rather than at zero: it leaves headroom inside the
    // millisecond while still not leaking how many ids were minted.
    counter = randomBytes(2).readUInt16BE(0) & 0x3ff
    return counter
  }

  if (counter >= MAX_COUNTER) {
    // More than 4096 ids in one millisecond. Rolling over would break
    // monotonicity, so borrow from the next millisecond instead.
    lastTimestamp += 1
    counter = 0
    return counter
  }

  counter += 1
  return counter
}

const HEX: string[] = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, '0'))

export function uuidv7(now: number = Date.now()): string {
  const count = nextCounter(now)
  const timestamp = lastTimestamp

  const bytes = randomBytes(16)

  bytes[0] = Math.floor(timestamp / 0x10000000000) & 0xff
  bytes[1] = Math.floor(timestamp / 0x100000000) & 0xff
  bytes[2] = Math.floor(timestamp / 0x1000000) & 0xff
  bytes[3] = Math.floor(timestamp / 0x10000) & 0xff
  bytes[4] = Math.floor(timestamp / 0x100) & 0xff
  bytes[5] = timestamp & 0xff

  bytes[6] = 0x70 | ((count >> 8) & 0x0f)
  bytes[7] = count & 0xff

  bytes[8] = 0x80 | (bytes[8]! & 0x3f)

  let out = ''
  for (let index = 0; index < 16; index += 1) {
    out += HEX[bytes[index]!]
    if (index === 3 || index === 5 || index === 7 || index === 9) out += '-'
  }
  return out
}

/** Milliseconds encoded in a UUIDv7. Useful in tests and in the audit tooling. */
export function uuidv7Timestamp(id: string): number {
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}
