import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { purchaseBookingTaxCodes, salesBookingTaxCodes } from '../../src/lib/booking-tax-codes.js'

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
    taxCodes: readonly { code: string; direction: string }[]
  }
).taxCodes

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
})
