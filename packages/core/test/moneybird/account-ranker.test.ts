import { describe, expect, it } from 'vitest'
import {
  hasUniqueVatMatch,
  matchVatCodes,
  nextFreeNumber,
  rankAccountSuggestions,
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
    { code: 'H21', rateBasisPoints: 2100, direction: 'output' as const },
    { code: 'VH21', rateBasisPoints: 2100, direction: 'input' as const },
    { code: 'H9', rateBasisPoints: 900, direction: 'output' as const },
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

  it('offers one-click only when exactly one rule matches', () => {
    expect(hasUniqueVatMatch(rules, { percentage: 21, taxRateType: 'sales_invoice' })).toBe(true)
    expect(
      hasUniqueVatMatch([...rules, { code: 'H21b', rateBasisPoints: 2100, direction: 'output' }], {
        percentage: 21,
        taxRateType: 'sales_invoice',
      }),
    ).toBe(false)
  })

  it('returns no matches for an unknown taxRateType', () => {
    expect(matchVatCodes(rules, { percentage: 21, taxRateType: 'unknown' })).toEqual([])
    expect(matchVatCodes(rules, { percentage: 21, taxRateType: '' })).toEqual([])
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
