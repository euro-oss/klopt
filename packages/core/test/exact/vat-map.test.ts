import { describe, expect, it } from 'vitest'
import { parseVatCode } from '../../src/exact/resources.js'
import { mapExactVatCodes, recogniseExactVatCode } from '../../src/exact/vat-map.js'

const RULES = [
  {
    code: 'H21',
    description: 'BTW hoog 21%',
    rateBasisPoints: 2100,
    direction: 'output' as const,
    scope: 'domestic',
    reverseCharge: 'none',
  },
  {
    code: 'L9',
    description: 'BTW laag 9%',
    rateBasisPoints: 900,
    direction: 'output' as const,
    scope: 'domestic',
    reverseCharge: 'none',
  },
  {
    code: 'VH21',
    description: 'Voorbelasting hoog 21%',
    rateBasisPoints: 2100,
    direction: 'input' as const,
    scope: 'domestic',
    reverseCharge: 'none',
  },
  {
    code: 'VL9',
    description: 'Voorbelasting laag 9%',
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
  it('recognises only when code, rate and side all agree', () => {
    expect(
      recogniseExactVatCode(
        vat({
          Code: 'H21',
          Description: 'BTW hoog verkoop 21%',
          Percentage: 0.21,
          Type: 'E',
          VATTransactionType: 'S',
          IsBlocked: false,
          Charged: false,
        }),
        RULES,
      ),
    ).toMatchObject({ rule: { code: 'H21' }, codeMatch: true })

    expect(
      recogniseExactVatCode(
        vat({
          Code: 'VH21',
          Description: 'BTW hoog inkoop 21%',
          Percentage: 0.21,
          Type: 'E',
          VATTransactionType: 'P',
          IsBlocked: false,
          Charged: false,
        }),
        RULES,
      ),
    ).toMatchObject({ rule: { code: 'VH21' }, codeMatch: true })
  })

  it('leaves H21 at 9% unrecognised — code match does not override rate (#161 QA/PM)', () => {
    const code = vat({
      Code: 'H21',
      Description: 'Iets anders',
      Percentage: 0.09,
      Type: 'E',
      VATTransactionType: 'S',
      IsBlocked: false,
      Charged: false,
    })
    expect(recogniseExactVatCode(code, RULES)).toBeNull()
  })

  it('does not recognise by rate+side alone when the Exact code string differs', () => {
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
      ),
    ).toBeNull()
  })

  it('leaves sales-side Geen BTW unrecognised — never purchase-only VGEEN (NL + EN)', () => {
    for (const description of ['Geen BTW', 'No VAT', 'Zero rated'] as const) {
      expect(
        recogniseExactVatCode(
          vat({
            Code: '0',
            Description: description,
            Percentage: 0,
            Type: 'N',
            VATTransactionType: 'S',
            IsBlocked: false,
            Charged: false,
          }),
          RULES,
        ),
        description,
      ).toBeNull()
    }
    // Exact "both" also never agrees with a single-direction Klopt row.
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
      ),
    ).toBeNull()
  })

  it('maps purchase-side VGEEN only when code+rate+side agree', () => {
    expect(
      recogniseExactVatCode(
        vat({
          Code: 'VGEEN',
          Description: 'Inkoop zonder btw',
          Percentage: 0,
          Type: 'N',
          VATTransactionType: 'P',
          IsBlocked: false,
          Charged: false,
        }),
        RULES,
      ),
    ).toMatchObject({ rule: { code: 'VGEEN' }, codeMatch: true })
  })

  it('leaves export descriptions unrecognised, never VGEEN (NL + EN)', () => {
    for (const description of [
      'Zero rated export',
      'Geen btw - export buiten de EU',
      'Verkoop 0% buiten EU',
      'Uitvoer 0%',
      'Export outside the EU',
    ] as const) {
      expect(
        recogniseExactVatCode(
          vat({
            Code: 'VGEEN',
            Description: description,
            Percentage: 0,
            Type: 'E',
            VATTransactionType: 'S',
            IsBlocked: false,
            Charged: false,
          }),
          RULES,
        ),
        description,
      ).toBeNull()
    }
  })

  it('leaves EU and non-EU service purchases unrecognised, never VH21 (NL + EN)', () => {
    for (const description of [
      'Diensten buiten de EU',
      'Inkoop diensten uit EU-landen',
      'Verlegd inkoop EU',
      'Services outside the EU',
      'EU service purchases',
    ] as const) {
      expect(
        recogniseExactVatCode(
          vat({
            Code: 'VH21',
            Description: description,
            Percentage: 0.21,
            Type: 'E',
            VATTransactionType: 'P',
            IsBlocked: false,
            Charged: false,
          }),
          RULES,
        ),
        description,
      ).toBeNull()
    }
  })

  it('leaves a missing side (Exact both) unrecognised even when code and rate match', () => {
    expect(
      recogniseExactVatCode(
        vat({
          Code: 'H21',
          Description: 'BTW hoog',
          Percentage: 0.21,
          Type: 'E',
          VATTransactionType: 'B',
          IsBlocked: false,
          Charged: false,
        }),
        RULES,
      ),
    ).toBeNull()
  })

  it('leaves a code/side mismatch unrecognised (sales code on purchase side)', () => {
    expect(
      recogniseExactVatCode(
        vat({
          Code: 'H21',
          Description: 'BTW hoog inkoop',
          Percentage: 0.21,
          Type: 'E',
          VATTransactionType: 'P',
          IsBlocked: false,
          Charged: false,
        }),
        RULES,
      ),
    ).toBeNull()
  })

  it('refuses Exact Charged / reverse-charge flag even when code+rate+side would match', () => {
    expect(
      recogniseExactVatCode(
        vat({
          Code: 'VH21',
          Description: 'BTW hoog inkoop 21%',
          Percentage: 0.21,
          Type: 'E',
          VATTransactionType: 'P',
          IsBlocked: false,
          Charged: true,
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
          Code: 'H21',
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
        { number: '8000', name: 'Omzet', vatCode: 'H21' },
      ],
      kloptRules: RULES,
      existingTaxCodes: RULES.map((rule) => rule.code),
    })

    expect(summary.codeCount).toBe(2)
    expect(summary.recognised).toBe(1)
    expect(summary.rows[0]).toMatchObject({
      exactCode: 'H21',
      kloptCode: 'H21',
      kloptLabel: 'BTW hoog 21%',
      codeMatch: true,
      accountsLosingDefault: [],
    })
    expect(summary.rows[1]).toMatchObject({
      exactCode: '7',
      kloptCode: null,
    })
    expect(summary.rows[1]?.accountsLosingDefault.map((a) => a.number)).toEqual(['4400', '4410'])
  })

  it('lists lose-default when code string exists but rate disagrees', () => {
    const summary = mapExactVatCodes({
      vatCodes: [
        vat({
          Code: 'H21',
          Description: 'BTW laag per ongeluk',
          Percentage: 0.09,
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
    expect(summary.rows[0]?.kloptCode).toBeNull()
    expect(summary.rows[0]?.codeMatch).toBe(false)
    expect(summary.rows[0]?.accountsLosingDefault.map((a) => a.number)).toEqual(['8000'])
  })
})
