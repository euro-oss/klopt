import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadChart } from '../../src/setup/chart.js'
import {
  RUBRIEKEN,
  assertTaxCodeRule,
  checkTaxCodeRule,
  feedsIcp,
  isAssignableRubriek,
  recoverableBasisPoints,
  ruleInForce,
  type TaxCodeRule,
} from '../../src/vat/index.js'

const REFERENCE_DATA = join(import.meta.dirname, '..', '..', '..', '..', 'reference-data')

function rule(overrides: Partial<TaxCodeRule> = {}): TaxCodeRule {
  return {
    code: 'H21',
    description: 'BTW hoog',
    rateBasisPoints: 2100,
    validFrom: '2026-01-01',
    validTo: null,
    direction: 'output',
    baseRubriek: '1a',
    vatRubriek: '1a',
    reverseCharge: 'none',
    scope: 'domestic',
    deductibility: 'full',
    proRataBasisPoints: null,
    supplyKind: 'not_applicable',
    ublCategory: 'S',
    deductionCode: null,
    ...overrides,
  }
}

function codesOf(overrides: Partial<TaxCodeRule>): string[] {
  return checkTaxCodeRule(rule(overrides)).map((problem) => problem.code)
}

describe('checkTaxCodeRule', () => {
  it('accepts a plain domestic sale at the high rate', () => {
    expect(checkTaxCodeRule(rule())).toEqual([])
  })

  it('refuses a rate with nowhere to declare its VAT', () => {
    // The misconfiguration that silently under-declares: the base shows up in
    // 1a and the tax vanishes.
    expect(codesOf({ vatRubriek: null })).toContain('invalid_tax_code')
  })

  it('refuses a zero-rate code that claims a VAT box', () => {
    expect(codesOf({ rateBasisPoints: 0, vatRubriek: '1a' })).toContain('invalid_tax_code')
  })

  it('refuses a tax code pointing at a computed subtotal', () => {
    expect(codesOf({ vatRubriek: '5a' })).toContain('unknown_rubriek')
    expect(codesOf({ baseRubriek: '5c', vatRubriek: '1a' })).toContain('unknown_rubriek')
  })

  it('refuses a rubriek that is not on the form', () => {
    expect(codesOf({ baseRubriek: '9z' })).toContain('unknown_rubriek')
  })

  it('refuses a base in a box that reports no base', () => {
    expect(codesOf({ baseRubriek: '5b' })).toContain('invalid_tax_code')
  })

  it('makes scope and rubriek agree, because scope decides the box', () => {
    expect(
      codesOf({ scope: 'export', rateBasisPoints: 0, vatRubriek: null, baseRubriek: '1a' }),
    ).toContain('invalid_tax_code')
    expect(
      checkTaxCodeRule(
        rule({ scope: 'export', rateBasisPoints: 0, vatRubriek: null, baseRubriek: '3a' }),
      ),
    ).toEqual([])
  })

  it('requires an intra-community supply to say goods or services, for the ICP', () => {
    const problems = checkTaxCodeRule(
      rule({
        scope: 'intra_community_supply',
        rateBasisPoints: 0,
        vatRubriek: null,
        baseRubriek: '3b',
        supplyKind: 'not_applicable',
      }),
    )
    expect(problems.map((problem) => problem.code)).toContain('invalid_tax_code')
  })

  it('forbids a base box on a code whose VAT lands in 5b', () => {
    // Rubriek 5b reports voorbelasting and nothing else. There is no box for a
    // domestic purchase's base, so claiming one is a configuration error.
    expect(codesOf({ direction: 'input', vatRubriek: '5b', baseRubriek: '1a' })).toContain(
      'invalid_tax_code',
    )
    expect(
      checkTaxCodeRule(rule({ direction: 'input', vatRubriek: '5b', baseRubriek: null })),
    ).toEqual([])
  })

  it('lets a reverse charge acquisition keep its base, because 4b has a box for it', () => {
    expect(
      checkTaxCodeRule(
        rule({
          direction: 'input',
          scope: 'intra_community_acquisition',
          baseRubriek: '4b',
          vatRubriek: '4b',
          supplyKind: 'goods',
          deductionCode: 'ICV21-VOOR',
        }),
      ),
    ).toEqual([])
  })

  it('refuses a domestic reverse charge that still charges VAT on the way out', () => {
    expect(codesOf({ reverseCharge: 'domestic', rateBasisPoints: 2100 })).toContain(
      'invalid_tax_code',
    )
  })

  it('ties article 23 deferment to an import', () => {
    expect(codesOf({ reverseCharge: 'import_article_23', scope: 'domestic' })).toContain(
      'invalid_tax_code',
    )
  })

  it('wants a share on a pro rata code, and only on a pro rata code', () => {
    expect(
      codesOf({
        direction: 'input',
        vatRubriek: '5b',
        baseRubriek: null,
        deductibility: 'pro_rata',
      }),
    ).toContain('invalid_tax_code')
    expect(
      codesOf({
        direction: 'input',
        vatRubriek: '5b',
        baseRubriek: null,
        deductibility: 'pro_rata',
        proRataBasisPoints: 10_000,
      }),
    ).toContain('invalid_tax_code')
    expect(
      checkTaxCodeRule(
        rule({
          direction: 'input',
          vatRubriek: '5b',
          baseRubriek: null,
          deductibility: 'pro_rata',
          proRataBasisPoints: 6_500,
        }),
      ),
    ).toEqual([])
    expect(codesOf({ proRataBasisPoints: 6_500 })).toContain('invalid_tax_code')
  })

  it('refuses deductibility on an output code, which has none', () => {
    expect(codesOf({ deductibility: 'none' })).toContain('invalid_tax_code')
  })

  it('refuses a validity window that ends before it starts', () => {
    expect(codesOf({ validFrom: '2026-04-01', validTo: '2026-01-01' })).toContain('invalid_date')
  })

  it('throws with every problem at once', () => {
    expect(() => {
      assertTaxCodeRule(rule({ baseRubriek: '9z', vatRubriek: '5a', validFrom: 'later' }))
    }).toThrow(/rubriek|date/i)
  })
})

describe('recoverableBasisPoints', () => {
  it('is all, none, or the stated share', () => {
    const input = { direction: 'input', vatRubriek: '5b', baseRubriek: null } as const
    expect(recoverableBasisPoints(rule({ ...input }))).toBe(10_000)
    expect(recoverableBasisPoints(rule({ ...input, deductibility: 'none' }))).toBe(0)
    expect(
      recoverableBasisPoints(
        rule({ ...input, deductibility: 'pro_rata', proRataBasisPoints: 6_500 }),
      ),
    ).toBe(6_500)
  })
})

describe('ruleInForce', () => {
  const history = [
    rule({ code: 'H', rateBasisPoints: 2100, validFrom: '2019-01-01', validTo: null }),
    rule({ code: 'H', rateBasisPoints: 1900, validFrom: '2012-10-01', validTo: '2018-12-31' }),
  ]

  it('picks the window the booking date falls in', () => {
    expect(ruleInForce(history, 'H', '2026-02-15')?.rateBasisPoints).toBe(2100)
    expect(ruleInForce(history, 'H', '2015-06-30')?.rateBasisPoints).toBe(1900)
  })

  it('finds nothing in the gap, rather than guessing', () => {
    // A rate change is a new row; a hole between rows is a configuration error
    // the return has to report, not paper over.
    expect(ruleInForce(history, 'H', '2010-01-01')).toBeUndefined()
  })
})

describe('the shipped charts', () => {
  const charts = readdirSync(join(REFERENCE_DATA, 'charts'))
    .filter((name) => name.endsWith('.json'))
    .map((name) =>
      loadChart(JSON.parse(readFileSync(join(REFERENCE_DATA, 'charts', name), 'utf8'))),
    )

  it.each(charts.map((chart) => [chart.code, chart] as const))(
    '%s configures every tax code coherently',
    (_code, chart) => {
      const problems = chart.taxCodes.flatMap((code) =>
        checkTaxCodeRule({
          ...code,
          validFrom: '2026-01-01',
          validTo: null,
        }),
      )
      expect(problems).toEqual([])
    },
  )

  it.each(charts.map((chart) => [chart.code, chart] as const))(
    '%s pairs every reverse charge with a deduction code that exists',
    (_code, chart) => {
      const known = new Set(chart.taxCodes.map((code) => code.code))
      for (const code of chart.taxCodes) {
        if (code.deductionCode === null) continue
        expect(known, `${code.code} points at ${code.deductionCode}`).toContain(code.deductionCode)
        const paired = chart.taxCodes.find((entry) => entry.code === code.deductionCode)
        // The deduction half declares voorbelasting and no base, or the same
        // purchase would be declared twice.
        expect(paired?.vatRubriek).toBe('5b')
        expect(paired?.baseRubriek).toBeNull()
      }
    },
  )

  it.each(charts.map((chart) => [chart.code, chart] as const))(
    '%s can declare every box the form has, or knowingly leaves it to a custom code',
    (_code, chart) => {
      // Not every entity needs 1c or 3c, so this is not a completeness demand.
      // What it does catch is a chart that ships a code for a box that is not
      // on the form at all.
      for (const code of chart.taxCodes) {
        for (const box of [code.baseRubriek, code.vatRubriek]) {
          if (box === null) continue
          expect(isAssignableRubriek(box), `${code.code} -> ${box}`).toBe(true)
        }
      }
    },
  )

  it('ships a code for the ICP opgaaf, for goods and for services', () => {
    for (const chart of charts) {
      const icp = chart.taxCodes.filter((code) =>
        feedsIcp({ ...code, validFrom: '2026-01-01', validTo: null }),
      )
      expect(icp.map((code) => code.supplyKind).sort()).toEqual(['goods', 'services'])
      // Rubriek 3b is what the ICP totals are cross-checked against.
      expect(new Set(icp.map((code) => code.baseRubriek))).toEqual(new Set(['3b']))
    }
  })
})

describe('the rubriek catalogue', () => {
  it('has a unique, non-empty id for every box', () => {
    const ids = RUBRIEKEN.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.length >= 2)).toBe(true)
  })

  it('refuses to let a tax code write to a subtotal', () => {
    expect(isAssignableRubriek('1a')).toBe(true)
    expect(isAssignableRubriek('5b')).toBe(true)
    expect(isAssignableRubriek('5a')).toBe(false)
    expect(isAssignableRubriek('5c')).toBe(false)
  })
})
