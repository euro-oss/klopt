import { describe, expect, it } from 'vitest'
import {
  hasUniqueVatMatch,
  matchVatCodes,
  nextFreeNumber,
  rankAccountSuggestions,
  rankVatCodes,
} from '../../src/index.js'

const chart = [
  { number: '8000', name: 'Omzet', rgsCode: 'WOmz' },
  { number: '8001', name: 'Omzet diensten', rgsCode: 'WOmzDi' },
  { number: '4000', name: 'Inkoop', rgsCode: 'WKru' },
  { number: '4400', name: 'Kantoorkosten', rgsCode: 'WKruKa' },
  { number: '1300', name: 'Debiteuren', rgsCode: 'BVorDeb' },
]

describe('rankAccountSuggestions', () => {
  it('ranks RGS before number before name', () => {
    const ranked = rankAccountSuggestions(chart, {
      rgsCode: 'WOmz',
      number: '4000',
      name: 'Debiteuren',
    })
    expect(ranked[0]?.account.number).toBe('8000')
    expect(ranked[0]?.reason).toBe('rgs')
    expect(ranked.map((row) => row.account.number)).toContain('4000')
    expect(ranked.map((row) => row.account.number)).toContain('1300')
    const rgsRank = ranked.find((row) => row.account.number === '8000')!.rank
    const numberRank = ranked.find((row) => row.account.number === '4000')!.rank
    const nameRank = ranked.find((row) => row.account.number === '1300')!.rank
    expect(rgsRank).toBeLessThan(numberRank)
    expect(numberRank).toBeLessThan(nameRank)
  })

  it('filters by typed query while keeping RGS preference', () => {
    const ranked = rankAccountSuggestions(chart, {
      rgsCode: 'WOmz',
      number: '',
      name: '',
      query: 'omzet',
    })
    expect(ranked.map((row) => row.account.number)).toEqual(['8000', '8001'])
  })
})

describe('matchVatCodes', () => {
  const rules = [
    {
      code: 'H21',
      rateBasisPoints: 2100,
      direction: 'output' as const,
      scope: 'domestic',
      reverseCharge: 'none',
    },
    {
      code: 'VH21',
      rateBasisPoints: 2100,
      direction: 'input' as const,
      scope: 'domestic',
      reverseCharge: 'none',
    },
    {
      code: 'H9',
      rateBasisPoints: 900,
      direction: 'output' as const,
      scope: 'domestic',
      reverseCharge: 'none',
    },
  ]

  it('matches by direction and rate', () => {
    expect(
      matchVatCodes(rules, { percentage: 21, taxRateType: 'sales_invoice' }).map(
        (rule) => rule.code,
      ),
    ).toEqual(['H21'])
    expect(
      matchVatCodes(rules, { percentage: 21, taxRateType: 'purchase_invoice' }).map(
        (rule) => rule.code,
      ),
    ).toEqual(['VH21'])
  })

  it('offers one-click only when exactly one primary rule matches', () => {
    expect(hasUniqueVatMatch(rules, { percentage: 21, taxRateType: 'sales_invoice' })).toBe(true)
    expect(
      hasUniqueVatMatch(
        [
          ...rules,
          {
            code: 'H21b',
            rateBasisPoints: 2100,
            direction: 'output',
            scope: 'domestic',
            reverseCharge: 'none',
          },
        ],
        {
          percentage: 21,
          taxRateType: 'sales_invoice',
        },
      ),
    ).toBe(false)
  })

  it('never treats missing scope or reverseCharge as primary', () => {
    const ranked = rankVatCodes([{ code: 'X21', rateBasisPoints: 2100, direction: 'output' }], {
      percentage: 21,
      taxRateType: 'sales_invoice',
    })
    expect(ranked.primary).toEqual([])
    expect(ranked.other.map((rule) => rule.code)).toEqual(['X21'])
    expect(ranked.suggestedCode).toBeNull()
  })

  it('returns no matches for an unknown taxRateType', () => {
    expect(matchVatCodes(rules, { percentage: 21, taxRateType: 'unknown' })).toEqual([])
    expect(matchVatCodes(rules, { percentage: 21, taxRateType: '' })).toEqual([])
  })

  it('returns no matches for a non-finite percentage', () => {
    expect(matchVatCodes(rules, { percentage: Number.NaN, taxRateType: 'sales_invoice' })).toEqual(
      [],
    )
    expect(
      matchVatCodes(rules, { percentage: Number.POSITIVE_INFINITY, taxRateType: 'sales_invoice' }),
    ).toEqual([])
  })

  it('ranks the plain standard code primary and suggests it when unique', () => {
    const ranked = rankVatCodes(
      [
        ...rules,
        {
          code: 'PRIV21',
          rateBasisPoints: 2100,
          direction: 'output',
          scope: 'private_use',
          reverseCharge: 'none',
        },
        {
          code: 'VERL-ONTV',
          rateBasisPoints: 2100,
          direction: 'input',
          scope: 'domestic',
          reverseCharge: 'domestic',
          deductionCode: 'VERL-VOOR',
        },
      ],
      { percentage: 21, taxRateType: 'sales_invoice' },
    )
    expect(ranked.primary.map((rule) => rule.code)).toEqual(['H21'])
    expect(ranked.other.map((rule) => rule.code)).toEqual(['PRIV21'])
    expect(ranked.suggestedCode).toBe('H21')
    expect(ranked.candidates.map((row) => row.group)).toEqual(['primary', 'other'])
  })
})

describe('nextFreeNumber', () => {
  it('returns the preferred number when free', () => {
    expect(nextFreeNumber('1300', ['1100'])).toBe('1300')
  })

  it('increments a numeric collision', () => {
    expect(nextFreeNumber('1300', ['1300', '1301'])).toBe('1302')
  })

  it('suffixes a non-numeric collision', () => {
    expect(nextFreeNumber('MB-9', ['MB-9'])).toBe('MB-9-2')
  })
})
