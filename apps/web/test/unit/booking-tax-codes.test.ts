import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  defaultPurchaseBookingTaxCode,
  defaultSalesBookingTaxCode,
  purchaseBookingTaxCodes,
  salesBookingTaxCodes,
  taxCodeValidOn,
} from '../../src/lib/booking-tax-codes.js'

const chartPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'reference-data',
  'charts',
  'nl-mkb.json',
)

const chartTaxCodes = (
  JSON.parse(readFileSync(chartPath, 'utf8')) as {
    taxCodes: readonly {
      code: string
      direction: string
      validFrom?: string
      validTo?: string | null
    }[]
  }
).taxCodes.map((row) => ({ ...row, validFrom: '2019-01-01', validTo: null }))

describe('booking tax code pickers (full nl-mkb chart)', () => {
  it('excludes L6, H19 and PRIV21 from new sales booking pickers', () => {
    const codes = salesBookingTaxCodes(chartTaxCodes).map((row) => row.code)
    expect(codes).not.toContain('L6')
    expect(codes).not.toContain('H19')
    expect(codes).not.toContain('PRIV21')
    expect(codes).toContain('H21')
    expect(codes).toContain('L9')
    expect(
      codes.every((code) => chartTaxCodes.find((row) => row.code === code)?.direction === 'output'),
    ).toBe(true)
  })

  it('excludes VL6 and VH19 from new purchase booking pickers', () => {
    const codes = purchaseBookingTaxCodes(chartTaxCodes).map((row) => row.code)
    expect(codes).not.toContain('VL6')
    expect(codes).not.toContain('VH19')
    expect(codes).not.toContain('L6')
    expect(codes).not.toContain('H19')
    expect(codes).not.toContain('PRIV21')
    expect(codes).toContain('VH21')
    expect(codes).toContain('VL9')
    expect(codes).toContain('VGEEN')
    expect(
      codes.every((code) => chartTaxCodes.find((row) => row.code === code)?.direction === 'input'),
    ).toBe(true)
  })

  it('hides codes ended before the booking date and keeps validTo inclusive', () => {
    const withWindows = chartTaxCodes.map((row) =>
      row.code === 'H21'
        ? { ...row, validTo: '2026-03-31' }
        : row.code === 'L9'
          ? { ...row, validFrom: '2026-04-01', validTo: null }
          : row,
    )
    const onMarch = salesBookingTaxCodes(withWindows, '2026-03-31').map((row) => row.code)
    expect(onMarch).toContain('H21')
    expect(onMarch).not.toContain('L9')

    const onApril = salesBookingTaxCodes(withWindows, '2026-04-01').map((row) => row.code)
    expect(onApril).not.toContain('H21')
    expect(onApril).toContain('L9')
  })

  it('does not fall back when the usual sales default H21 has ended', () => {
    const withoutH21 = salesBookingTaxCodes(
      chartTaxCodes.map((row) => (row.code === 'H21' ? { ...row, validTo: '2025-12-31' } : row)),
      '2026-03-15',
    )
    expect(withoutH21.map((row) => row.code)).not.toContain('H21')
    expect(defaultSalesBookingTaxCode(withoutH21)).toBe('')
    expect(defaultSalesBookingTaxCode(salesBookingTaxCodes(chartTaxCodes, '2026-03-15'))).toBe(
      'H21',
    )
  })

  it('does not fall back when the usual purchase default VH21 has ended', () => {
    const withoutVh21 = purchaseBookingTaxCodes(
      chartTaxCodes.map((row) => (row.code === 'VH21' ? { ...row, validTo: '2025-12-31' } : row)),
      '2026-03-15',
    )
    expect(withoutVh21.map((row) => row.code)).not.toContain('VH21')
    expect(withoutVh21.map((row) => row.code)).toContain('VGEEN')
    expect(defaultPurchaseBookingTaxCode(withoutVh21)).toBe('')
  })

  it('treats validTo as inclusive in taxCodeValidOn', () => {
    expect(taxCodeValidOn({ validFrom: '2019-01-01', validTo: '2026-03-31' }, '2026-03-31')).toBe(
      true,
    )
    expect(taxCodeValidOn({ validFrom: '2019-01-01', validTo: '2026-03-31' }, '2026-04-01')).toBe(
      false,
    )
  })
})
