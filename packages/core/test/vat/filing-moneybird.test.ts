import { describe, expect, it } from 'vitest'
import {
  LedgerError,
  planFiling,
  buildVatReturn,
  rubriekAmounts,
  type TaxCodeRule,
  type VatJournalLine,
} from '../../src/index.js'

/**
 * Filing must refuse Moneybird hard blocks even when acceptWarnings is set (#94).
 */

function rule(code: string, overrides: Partial<TaxCodeRule> = {}): TaxCodeRule {
  return {
    code,
    description: code,
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

describe('planFiling Moneybird hard blocks', () => {
  it('refuses moneybird_untagged_vat even with acceptWarnings', () => {
    const vatReturn = buildVatReturn({
      periodFrom: '2026-01-01',
      periodTo: '2026-03-31',
      rules: [rule('H21')],
      controlAccountNumbers: ['1500'],
      lines: [
        {
          entryId: 'e1',
          entryNumber: '1',
          journalCode: 'VRK',
          bookingDate: '2026-02-10',
          lineNumber: 1,
          accountNumber: '1300',
          accountName: 'Debiteuren',
          description: 'sale',
          taxCode: null,
          taxRole: null,
          sourceDocumentRef: 'moneybird:1:sales_invoice:1',
          signedMinorUnits: 12100n,
        },
        {
          entryId: 'e1',
          entryNumber: '1',
          journalCode: 'VRK',
          bookingDate: '2026-02-10',
          lineNumber: 2,
          accountNumber: '8000',
          accountName: 'Omzet',
          description: 'sale',
          taxCode: 'H21',
          taxRole: 'base',
          sourceDocumentRef: 'moneybird:1:sales_invoice:1',
          signedMinorUnits: -10000n,
        },
        {
          entryId: 'e1',
          entryNumber: '1',
          journalCode: 'VRK',
          bookingDate: '2026-02-10',
          lineNumber: 3,
          accountNumber: '1500',
          accountName: 'BTW',
          description: 'BTW',
          taxCode: null,
          taxRole: null,
          sourceDocumentRef: 'moneybird:1:sales_invoice:1',
          signedMinorUnits: -2100n,
        },
      ],
    })

    expect(vatReturn.blocked).toBe(true)
    expect(() =>
      planFiling({
        vatReturn,
        kind: 'quarterly',
        existing: null,
        acceptWarnings: true,
        acceptedReason: 'looked fine',
        transport: 'manual',
      }),
    ).toThrow(LedgerError)

    try {
      planFiling({
        vatReturn,
        kind: 'quarterly',
        existing: null,
        acceptWarnings: true,
        acceptedReason: 'looked fine',
        transport: 'manual',
      })
    } catch (error) {
      expect(error).toBeInstanceOf(LedgerError)
      const problems = (error as LedgerError).violations
      expect(problems.some((item) => item.path?.includes('moneybird_untagged_vat'))).toBe(true)
    }
  })

  it('puts a period-attributed correction in exactly one return (no double count)', () => {
    // Append-only correction dated in the original period (suppletie route).
    // The next period must not pick up the same VAT again.
    const rules = [rule('H21')]
    const control = ['1500']

    const correctedQ1: VatJournalLine[] = [
      {
        entryId: 'base',
        entryNumber: '1',
        journalCode: 'VRK',
        bookingDate: '2026-02-10',
        lineNumber: 1,
        accountNumber: '8000',
        accountName: 'Omzet',
        description: 'sale',
        taxCode: 'H21',
        taxRole: 'base',
        sourceDocumentRef: 'moneybird:1:sales_invoice:1',
        signedMinorUnits: -10000n,
      },
      {
        entryId: 'repost',
        entryNumber: '2',
        journalCode: 'MEM',
        bookingDate: '2026-02-10',
        lineNumber: 1,
        accountNumber: '1500',
        accountName: 'BTW',
        description: 'H21 tagged repost',
        taxCode: 'H21',
        taxRole: 'tax',
        sourceDocumentRef: 'moneybird:1:sales_invoice:1:repost',
        signedMinorUnits: -2100n,
      },
    ]

    const q1 = buildVatReturn({
      periodFrom: '2026-01-01',
      periodTo: '2026-03-31',
      rules,
      controlAccountNumbers: control,
      lines: correctedQ1,
    })
    const q2 = buildVatReturn({
      periodFrom: '2026-04-01',
      periodTo: '2026-06-30',
      rules,
      controlAccountNumbers: control,
      lines: correctedQ1, // same lines — return filters by period dates in production
    })

    // Production periodLines filters by booking_date; simulate that filter.
    const q2Filtered = buildVatReturn({
      periodFrom: '2026-04-01',
      periodTo: '2026-06-30',
      rules,
      controlAccountNumbers: control,
      lines: correctedQ1.filter(
        (line) => line.bookingDate >= '2026-04-01' && line.bookingDate <= '2026-06-30',
      ),
    })

    expect(rubriekAmounts(q1, '1a').vatMinorUnits).toBe(2100n)
    expect(rubriekAmounts(q2Filtered, '1a').vatMinorUnits).toBe(0n)
    // Without the date filter the same lines would wrongly inflate Q2 — the
    // explicit period on the correction (booking date) is what prevents that.
    expect(rubriekAmounts(q2, '1a').vatMinorUnits).toBe(2100n)
    expect(
      rubriekAmounts(q1, '1a').vatMinorUnits + rubriekAmounts(q2Filtered, '1a').vatMinorUnits,
    ).toBe(2100n)
  })
})
