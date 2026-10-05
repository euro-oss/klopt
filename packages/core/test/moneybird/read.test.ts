import { describe, expect, it } from 'vitest'
import {
  MoneybirdReadError,
  minorFromMoneybirdAmount,
  readDate,
  readId,
  readMinor,
  readString,
  requireId,
} from '../../src/index.js'

describe('reading ids', () => {
  it('accepts the integer JSON actually sends', () => {
    expect(readId({ id: 123456 }, 'id')).toBe('123456')
    expect(requireId({ id: '123456' }, 'id')).toBe('123456')
  })

  it('refuses a fractional id rather than truncating it', () => {
    expect(readId({ id: 1.5 }, 'id')).toBeNull()
  })
})

describe('reading amounts', () => {
  it('reads a decimal string as cents', () => {
    expect(readMinor({ total_price_incl_tax: '121.00' }, 'total_price_incl_tax')).toBe(12100n)
    expect(minorFromMoneybirdAmount(121)).toBe(12100n)
  })

  it('refuses an amount that is not whole cents', () => {
    expect(() => minorFromMoneybirdAmount(1.001)).toThrow(MoneybirdReadError)
  })
})

describe('reading dates and strings', () => {
  it('keeps the calendar date', () => {
    expect(readDate({ invoice_date: '2026-03-31' }, 'invoice_date')).toBe('2026-03-31')
    expect(readDate({ invoice_date: '2026-03-31T00:00:00.000+01:00' }, 'invoice_date')).toBe(
      '2026-03-31',
    )
  })

  it('treats blank as absent', () => {
    expect(readString({ name: '  ' }, 'name')).toBeNull()
  })
})
