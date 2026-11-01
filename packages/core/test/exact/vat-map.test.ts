import { describe, expect, it } from 'vitest'
import { parseVatCode } from '../../src/exact/resources.js'
import { mapExactVatCodes, recogniseExactVatCode } from '../../src/exact/vat-map.js'

const RULES = [
  {
    code: 'H21',
    description: '21% btw',
    rateBasisPoints: 2100,
    direction: 'output' as const,
    scope: 'domestic',
    reverseCharge: 'none',
  },
  {
    code: 'L9',
    description: '9% btw',
    rateBasisPoints: 900,
    direction: 'output' as const,
    scope: 'domestic',
    reverseCharge: 'none',
  },
  {
    code: 'VH21',
    description: '21% btw',
    rateBasisPoints: 2100,
    direction: 'input' as const,
    scope: 'domestic',
    reverseCharge: 'none',
  },
  {
    code: 'VL9',
    description: '9% btw',
    rateBasisPoints: 900,
    direction: 'input' as const,
    scope: 'domestic',
    reverseCharge: 'none',
  },
  {
    code: 'VGEEN',
    description: 'Inkoop zonder btw',
    rateBasisPoints: 0,
    direction: 'input' as const,
    scope: 'out_of_scope',
    reverseCharge: 'none',
  },
  {
    code: 'GEEN',
    description: 'Vrijgesteld van BTW',
    rateBasisPoints: 0,
    direction: 'output' as const,
    scope: 'exempt',
    reverseCharge: 'none',
  },
  {
    code: 'ICV21',
    description: '21% btw over inkoop uit de EU',
    rateBasisPoints: 2100,
    direction: 'input' as const,
    scope: 'eu',
    reverseCharge: 'eu',
  },
]

function vat(row: Record<string, unknown>) {
  return parseVatCode(row)
}

describe('recogniseExactVatCode (#100 Exact read-only)', () => {
  it('matches when the Exact code string already exists in Klopt', () => {
    const code = vat({
      Code: 'H21',
      Description: 'Iets anders',
      Percentage: 0.09,
      Type: 'E',
      VATTransactionType: 'S',
      IsBlocked: false,
      Charged: false,
    })
    const hit = recogniseExactVatCode(code, RULES)
    expect(hit?.rule.code).toBe('H21')
    expect(hit?.codeMatch).toBe(true)
  })

  it('recognises domestic sales and purchase rates by percentage and side', () => {
    expect(
      recogniseExactVatCode(
        vat({
          Code: '1',
          Description: 'BTW hoog verkoop 21%',
          Percentage: 0.21,
          Type: 'E',
          VATTransactionType: 'S',
          IsBlocked: false,
          Charged: false,
        }),
        RULES,
      )?.rule.code,
    ).toBe('H21')

    expect(
      recogniseExactVatCode(
        vat({
          Code: '4',
          Description: 'BTW hoog inkoop 21%',
          Percentage: 0.21,
          Type: 'E',
          VATTransactionType: 'P',
          IsBlocked: false,
          Charged: false,
        }),
        RULES,
      )?.rule.code,
    ).toBe('VH21')

    expect(
      recogniseExactVatCode(
        vat({
          Code: '2',
          Description: 'BTW laag verkoop 9%',
          Percentage: 0.09,
          Type: 'E',
          VATTransactionType: 'S',
          IsBlocked: false,
          Charged: false,
        }),
        RULES,
      )?.rule.code,
    ).toBe('L9')
  })

  it('maps plain Geen BTW to VGEEN and refuses EU / reverse-charge names', () => {
    expect(
      recogniseExactVatCode(
        vat({
          Code: '0',
          Description: 'Geen BTW',
          Percentage: 0,
          Type: 'N',
          VATTransactionType: 'B',
          IsBlocked: false,
          Charged: false,
        }),
        RULES,
      )?.rule.code,
    ).toBe('VGEEN')

    expect(
      recogniseExactVatCode(
        vat({
          Code: '7',
          Description: 'Verlegd inkoop EU',
          Percentage: 0.21,
          Type: 'E',
          VATTransactionType: 'P',
          IsBlocked: false,
          Charged: true,
        }),
        RULES,
      ),
    ).toBeNull()

    expect(
      recogniseExactVatCode(
        vat({
          Code: '12',
          Description: 'Verkoop 0% buiten EU',
          Percentage: 0,
          Type: 'E',
          VATTransactionType: 'S',
          IsBlocked: false,
          Charged: false,
        }),
        RULES,
      ),
    ).toBeNull()
  })
})

describe('mapExactVatCodes (#100 Exact read-only)', () => {
  it('builds the design-shaped preview with lose-default accounts', () => {
    const summary = mapExactVatCodes({
      vatCodes: [
        vat({
          Code: '1',
          Description: 'BTW hoog verkoop 21%',
          Percentage: 0.21,
          Type: 'E',
          VATTransactionType: 'S',
          IsBlocked: false,
          Charged: false,
        }),
        vat({
          Code: '7',
          Description: 'Verlegd inkoop EU',
          Percentage: 0.21,
          Type: 'E',
          VATTransactionType: 'P',
          IsBlocked: false,
          Charged: true,
        }),
        vat({
          Code: 'OUD',
          Description: 'BTW 19% (oud)',
          Percentage: 0.19,
          Type: 'E',
          VATTransactionType: 'B',
          IsBlocked: true,
          Charged: false,
        }),
      ],
      accounts: [
        { number: '4400', name: 'Inkoop EU', vatCode: '7' },
        { number: '4410', name: 'Vrachtkosten EU', vatCode: '7' },
        { number: '8000', name: 'Omzet', vatCode: '1' },
      ],
      kloptRules: RULES,
      existingTaxCodes: RULES.map((rule) => rule.code),
    })

    expect(summary.codeCount).toBe(2)
    expect(summary.recognised).toBe(1)
    expect(summary.rows[0]).toMatchObject({
      exactCode: '1',
      kloptCode: 'H21',
      kloptLabel: '21% btw',
      accountsLosingDefault: [],
    })
    expect(summary.rows[1]).toMatchObject({
      exactCode: '7',
      kloptCode: null,
    })
    expect(summary.rows[1]?.accountsLosingDefault.map((a) => a.number)).toEqual(['4400', '4410'])
  })

  it('does not list lose-default when the Exact code string already exists', () => {
    const summary = mapExactVatCodes({
      vatCodes: [
        vat({
          Code: 'H21',
          Description: 'BTW hoog',
          Percentage: 0.21,
          Type: 'E',
          VATTransactionType: 'S',
          IsBlocked: false,
          Charged: false,
        }),
      ],
      accounts: [{ number: '8000', name: 'Omzet', vatCode: 'H21' }],
      kloptRules: RULES,
      existingTaxCodes: ['H21'],
    })
    expect(summary.rows[0]?.accountsLosingDefault).toEqual([])
    expect(summary.rows[0]?.codeMatch).toBe(true)
  })
})
