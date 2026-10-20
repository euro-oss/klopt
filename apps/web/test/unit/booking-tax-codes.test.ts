import { describe, expect, it } from 'vitest'
import { purchaseBookingTaxCodes, salesBookingTaxCodes } from '../../src/lib/booking-tax-codes.js'

const chart = [
  { code: 'H21', direction: 'output' },
  { code: 'L9', direction: 'output' },
  { code: 'L6', direction: 'output' },
  { code: 'H19', direction: 'output' },
  { code: 'PRIV21', direction: 'output' },
  { code: 'VH21', direction: 'input' },
  { code: 'VL9', direction: 'input' },
  { code: 'VL6', direction: 'input' },
  { code: 'VH19', direction: 'input' },
  { code: 'VGEEN', direction: 'input' },
]

describe('booking tax code pickers', () => {
  it('excludes L6, H19 and PRIV21 from new sales booking pickers', () => {
    expect(salesBookingTaxCodes(chart).map((row) => row.code)).toEqual(['H21', 'L9'])
  })

  it('excludes VL6 and VH19 from new purchase booking pickers', () => {
    expect(purchaseBookingTaxCodes(chart).map((row) => row.code)).toEqual(['VH21', 'VL9', 'VGEEN'])
  })
})
