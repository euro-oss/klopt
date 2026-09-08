import { describe, expect, it } from 'vitest'
import {
  ExactReadError,
  minorFromExactAmount,
  readBoolean,
  readDate,
  readGuid,
  readMinor,
  readString,
  requireString,
} from '../../src/index.js'

/**
 * Getting a value out of an Exact row.
 *
 * The interesting cases are all about Exact's own habits: keys padded to
 * eighteen characters, two different date encodings depending on the resource,
 * GUIDs sometimes in braces, and every amount typed as a double.
 */

describe('reading strings', () => {
  it('trims the leading spaces Exact pads its keys with', () => {
    // `crm/Accounts.Code` is documented as "fixed length numeric string with
    // leading spaces, length 18". Untrimmed, that is the debiteurennummer.
    const row = { Code: '            1000  ' }
    expect(requireString(row, 'Code')).toBe('1000')
  })

  it('treats an empty string as absent', () => {
    expect(readString({ Name: '   ' }, 'Name')).toBeNull()
    expect(readString({ Name: '' }, 'Name')).toBeNull()
  })

  it('refuses a missing string rather than substituting one', () => {
    expect(() => requireString({}, 'Code')).toThrow(ExactReadError)
  })
})

describe('reading dates', () => {
  it('reads the ISO form without shifting it', () => {
    // An invoice dated the 31st is dated the 31st. Applying a timezone to a
    // calendar date is how a booking moves into the previous quarter.
    expect(readDate({ InvoiceDate: '2026-03-31T00:00:00' }, 'InvoiceDate')).toBe('2026-03-31')
    expect(readDate({ DueDate: '2026-01-01' }, 'DueDate')).toBe('2026-01-01')
  })

  it('reads the /Date(ms)/ form older endpoints use', () => {
    // 2026-03-31T00:00:00Z
    expect(readDate({ ArchiveDate: '/Date(1774915200000)/' }, 'ArchiveDate')).toBe('2026-03-31')
  })

  it('reads the /Date(ms+0100)/ form', () => {
    expect(readDate({ ArchiveDate: '/Date(1774915200000+0100)/' }, 'ArchiveDate')).toBe(
      '2026-03-31',
    )
  })

  it('answers null for anything else', () => {
    expect(readDate({ DueDate: 'soon' }, 'DueDate')).toBeNull()
    expect(readDate({}, 'DueDate')).toBeNull()
  })
})

describe('reading GUIDs', () => {
  it('normalises case and strips braces', () => {
    // Exact returns both forms. Two spellings of one id would import the same
    // supplier twice.
    const braced = { ID: '{6E7F9B6C-1111-4222-8333-444455556666}' }
    const plain = { ID: '6e7f9b6c-1111-4222-8333-444455556666' }
    expect(readGuid(braced, 'ID')).toBe(readGuid(plain, 'ID'))
  })

  it('refuses something that is not a GUID', () => {
    expect(readGuid({ ID: 'not-a-guid' }, 'ID')).toBeNull()
  })
})

describe('reading booleans', () => {
  it('accepts Exact.Byte as a boolean, because Exact uses it as one', () => {
    expect(readBoolean({ UseCostcenter: 1 }, 'UseCostcenter')).toBe(true)
    expect(readBoolean({ UseCostcenter: 0 }, 'UseCostcenter')).toBe(false)
    expect(readBoolean({ IsBlocked: true }, 'IsBlocked')).toBe(true)
  })

  it('counts a missing flag as false', () => {
    expect(readBoolean({}, 'IsBlocked')).toBe(false)
  })
})

describe('amounts', () => {
  it('converts a double to whole cents', () => {
    expect(minorFromExactAmount(0)).toBe(0n)
    expect(minorFromExactAmount(12.34)).toBe(1234n)
    expect(minorFromExactAmount(-12.34)).toBe(-1234n)
  })

  it('survives the floats that need rounding', () => {
    // 1234567.89 * 100 is 123456788.99999999 in a double. Truncating would
    // lose a cent on every large invoice.
    expect(minorFromExactAmount(1234567.89)).toBe(123456789n)
    expect(minorFromExactAmount(0.07)).toBe(7n)
    expect(minorFromExactAmount(99999999.99)).toBe(9999999999n)
  })

  it('refuses a three-decimal amount, because money here has two', () => {
    // 1.005 is a unit price, not an amount. Rounding it to 1.00 or 1.01 would
    // be a decision this converter is not entitled to make.
    expect(() => minorFromExactAmount(1.005)).toThrow(/whole cents/)
  })

  it('refuses a value that is not an amount in cents', () => {
    // A third of a euro is not an amount. Rounding it silently is how a
    // reconciliation ends up two cents out with no explanation.
    expect(() => minorFromExactAmount(1 / 3)).toThrow(ExactReadError)
  })

  it('refuses a value too large for a double to hold to the cent', () => {
    expect(() => minorFromExactAmount(1e12)).toThrow(/too large/)
  })

  it('refuses NaN and infinity', () => {
    expect(() => minorFromExactAmount(Number.NaN)).toThrow(ExactReadError)
    expect(() => minorFromExactAmount(Number.POSITIVE_INFINITY)).toThrow(ExactReadError)
  })

  it('names the field in the error, so a plan can point at the row', () => {
    expect(() => readMinor({ AmountDebit: 1 / 3 }, 'AmountDebit')).toThrow(/AmountDebit/)
  })
})
