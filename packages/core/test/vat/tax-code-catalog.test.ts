import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadChart } from '../../src/setup/chart.js'
import {
  availableTaxCodeOffers,
  BOOKING_PICKER_EXCLUDED_CODES,
  isCorrectionOrImportOnly,
  resolveTaxCodeOffer,
  taxCodeOffersFromChart,
} from '../../src/vat/tax-code-catalog.js'

const REFERENCE = join(dirname(fileURLToPath(import.meta.url)), '../../../../reference-data')
const NL_MKB = loadChart(JSON.parse(readFileSync(join(REFERENCE, 'charts', 'nl-mkb.json'), 'utf8')))

describe('tax-code catalog from nl-mkb', () => {
  it('covers every chart code exactly once across offers', () => {
    const offers = taxCodeOffersFromChart(NL_MKB)
    const codes = offers.flatMap((offer) => offer.codes)
    expect(new Set(codes).size).toBe(codes.length)
    expect(new Set(codes)).toEqual(new Set(NL_MKB.taxCodes.map((row) => row.code)))
  })

  it('pairs reverse-charge / acquisition / import halves atomically', () => {
    const offers = taxCodeOffersFromChart(NL_MKB)
    const verl9 = offers.find((offer) => offer.key === 'VERL9-ONTV')
    expect(verl9).toMatchObject({
      pair: true,
      codes: ['VERL9-ONTV', 'VERL9-VOOR'],
      rateBasisPoints: 900,
    })
    expect(offers.find((offer) => offer.key === 'VERL9-VOOR')).toBeUndefined()

    const icv9 = offers.find((offer) => offer.key === 'ICV9')
    expect(icv9?.codes).toEqual(['ICV9', 'ICV9-VOOR'])

    const inv9 = offers.find((offer) => offer.key === 'INV9')
    expect(inv9?.codes).toEqual(['INV9', 'INV9-VOOR'])
  })

  it('keeps correction / import-only codes on the allowlist with a flag', () => {
    for (const code of ['L6', 'H19', 'VL6', 'VH19', 'PRIV21'] as const) {
      expect(BOOKING_PICKER_EXCLUDED_CODES.has(code)).toBe(true)
      expect(isCorrectionOrImportOnly(code)).toBe(true)
    }
    const l6 = taxCodeOffersFromChart(NL_MKB).find((offer) => offer.key === 'L6')
    expect(l6?.correctionOnly).toBe(true)
    expect(l6?.pair).toBe(false)
  })

  it('hides offers whose codes the entity already has, including half a pair', () => {
    const existing = new Set(['H21', 'VERL9-ONTV'])
    const available = availableTaxCodeOffers(NL_MKB, existing)
    expect(available.some((offer) => offer.key === 'H21')).toBe(false)
    // One half exists → the pair is not offered.
    expect(available.some((offer) => offer.key === 'VERL9-ONTV')).toBe(false)
    expect(available.some((offer) => offer.key === 'ICV9')).toBe(true)
  })

  it('resolves a posted key to the chart rows that must be inserted', () => {
    const offer = resolveTaxCodeOffer(NL_MKB, 'INV9')
    expect(offer?.entries.map((row) => row.code)).toEqual(['INV9', 'INV9-VOOR'])
    expect(resolveTaxCodeOffer(NL_MKB, 'INV9-VOOR')).toBeNull()
    expect(resolveTaxCodeOffer(NL_MKB, 'NOT-A-CODE')).toBeNull()
  })
})
