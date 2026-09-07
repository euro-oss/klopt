import { describe, expect, it } from 'vitest'
import {
  buildVatReturn,
  presentVatReturn,
  rubriekAmounts,
  type TaxCodeRule,
  type VatJournalLine,
  type VatReturn,
} from '../../src/vat/index.js'

/**
 * The BTW-aangifte, derived from a journal.
 *
 * These read as small books rather than as unit fixtures on purpose: the thing
 * being tested is that a set of journal lines produces the right boxes, and a
 * fixture that hands `buildVatReturn` pre-summed rubrieken would test nothing
 * at all.
 */

const CONTROL = ['1500', '1510']

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

const RULES: readonly TaxCodeRule[] = [
  rule('H21'),
  rule('L9', { rateBasisPoints: 900, baseRubriek: '1b', vatRubriek: '1b' }),
  rule('ICP', {
    rateBasisPoints: 0,
    baseRubriek: '3b',
    vatRubriek: null,
    scope: 'intra_community_supply',
    supplyKind: 'goods',
    ublCategory: 'K',
  }),
  rule('VH21', { direction: 'input', baseRubriek: null, vatRubriek: '5b' }),
  rule('ICV21', {
    direction: 'input',
    baseRubriek: '4b',
    vatRubriek: '4b',
    scope: 'intra_community_acquisition',
    supplyKind: 'goods',
    deductionCode: 'ICV21-VOOR',
  }),
  rule('ICV21-VOOR', {
    direction: 'input',
    baseRubriek: null,
    vatRubriek: '5b',
    scope: 'intra_community_acquisition',
  }),
]

let sequence = 0

/** Debit positive, credit negative — the convention `buildVatReturn` reads. */
function line(
  accountNumber: string,
  signedMinorUnits: bigint,
  extra: Partial<VatJournalLine> = {},
): VatJournalLine {
  sequence += 1
  return {
    entryId: `entry-${String(sequence)}`,
    entryNumber: String(sequence),
    journalCode: 'VRK',
    bookingDate: '2026-02-15',
    lineNumber: 1,
    accountNumber,
    accountName: `Account ${accountNumber}`,
    description: 'test',
    taxCode: null,
    taxRole: null,
    signedMinorUnits,
    ...extra,
  }
}

function build(lines: readonly VatJournalLine[]): VatReturn {
  return buildVatReturn({
    periodFrom: '2026-01-01',
    periodTo: '2026-03-31',
    lines,
    rules: RULES,
    controlAccountNumbers: CONTROL,
  })
}

/** One invoice: 1.000,00 at 21% to a Dutch customer. */
function domesticSale(): VatJournalLine[] {
  return [
    line('1300', 121_000n),
    line('8000', -100_000n, { taxCode: 'H21', taxRole: 'base' }),
    line('1500', -21_000n, { taxCode: 'H21', taxRole: 'tax' }),
  ]
}

describe('buildVatReturn', () => {
  it('puts a domestic sale in 1a with its base and its VAT, both positive', () => {
    const result = build(domesticSale())

    expect(rubriekAmounts(result, '1a')).toEqual({
      baseMinorUnits: 100_000n,
      vatMinorUnits: 21_000n,
    })
    expect(result.owedMinorUnits).toBe(21_000n)
    expect(result.deductibleMinorUnits).toBe(0n)
    expect(result.payableMinorUnits).toBe(21_000n)
    expect(result.blocked).toBe(false)
    expect(result.findings).toEqual([])
  })

  it('names every journal line behind a rubriek, which is the audit trail', () => {
    const result = build(domesticSale())
    const box = result.rubrieken.find((entry) => entry.rubriek.id === '1a')

    expect(box?.lines.map((entry) => [entry.accountNumber, entry.taxRole])).toEqual([
      ['8000', 'base'],
      ['1500', 'tax'],
    ])
  })

  it('reduces the box when a credit note reverses the sale', () => {
    const result = build([
      ...domesticSale(),
      line('1300', -60_500n),
      line('8000', 50_000n, { taxCode: 'H21', taxRole: 'base' }),
      line('1500', 10_500n, { taxCode: 'H21', taxRole: 'tax' }),
    ])

    expect(rubriekAmounts(result, '1a')).toEqual({
      baseMinorUnits: 50_000n,
      vatMinorUnits: 10_500n,
    })
    expect(result.blocked).toBe(false)
  })

  it('keeps two rates on one revenue account apart', () => {
    const result = build([
      line('1300', 130_000n),
      line('8000', -100_000n, { taxCode: 'H21', taxRole: 'base' }),
      line('8000', -1_000n, { taxCode: 'L9', taxRole: 'base' }),
      line('1500', -21_000n, { taxCode: 'H21', taxRole: 'tax' }),
      line('1500', -90n, { taxCode: 'L9', taxRole: 'tax' }),
    ])

    expect(rubriekAmounts(result, '1a')).toEqual({
      baseMinorUnits: 100_000n,
      vatMinorUnits: 21_000n,
    })
    expect(rubriekAmounts(result, '1b')).toEqual({
      baseMinorUnits: 1_000n,
      vatMinorUnits: 90n,
    })
    expect(result.blocked).toBe(false)
  })

  it('declares an intra-community supply as a base with no VAT', () => {
    const result = build([
      line('1300', 100_000n),
      line('8000', -100_000n, { taxCode: 'ICP', taxRole: 'base' }),
    ])

    expect(rubriekAmounts(result, '3b')).toEqual({ baseMinorUnits: 100_000n, vatMinorUnits: 0n })
    expect(result.owedMinorUnits).toBe(0n)
    expect(result.blocked).toBe(false)
  })

  it('deducts input VAT into 5b without declaring a base anywhere', () => {
    const result = build([
      line('4400', 100_000n, { taxCode: 'VH21', taxRole: 'base' }),
      line('1510', 21_000n, { taxCode: 'VH21', taxRole: 'tax' }),
      line('1600', -121_000n),
    ])

    expect(result.deductibleMinorUnits).toBe(21_000n)
    expect(result.payableMinorUnits).toBe(-21_000n)
    // The form has no box for a domestic purchase's base, so tagging one is
    // expected and produces no finding. A warning here would fire on every
    // return that has a single purchase in it.
    expect(result.findings).toEqual([])
    expect(result.blocked).toBe(false)
  })

  it('handles a reverse charge acquisition, whose base is a debit and VAT a credit', () => {
    // Goods bought in Germany for 1.000,00. The VAT is owed in 4b and deducted
    // in 5b, so the quarter is cash-neutral but both boxes are filled.
    const result = build([
      line('7000', 100_000n, { taxCode: 'ICV21', taxRole: 'base' }),
      line('1600', -100_000n),
      line('1500', -21_000n, { taxCode: 'ICV21', taxRole: 'tax' }),
      line('1510', 21_000n, { taxCode: 'ICV21-VOOR', taxRole: 'tax' }),
    ])

    expect(rubriekAmounts(result, '4b')).toEqual({
      baseMinorUnits: 100_000n,
      vatMinorUnits: 21_000n,
    })
    expect(result.owedMinorUnits).toBe(21_000n)
    expect(result.deductibleMinorUnits).toBe(21_000n)
    expect(result.payableMinorUnits).toBe(0n)
    expect(result.blocked).toBe(false)
  })
})

describe('the reconciliation, which blocks', () => {
  it('agrees with the control accounts when every line is coded', () => {
    const result = build(domesticSale())
    const payable = result.reconciliation.find((entry) => entry.accountNumber === '1500')

    expect(payable?.taggedMovementMinorUnits).toBe(-21_000n)
    expect(payable?.declaredMinorUnits).toBe(-21_000n)
    expect(payable?.differenceMinorUnits).toBe(0n)
    expect(result.blocked).toBe(false)
  })

  it('blocks when VAT is posted under a code that does not exist', () => {
    const result = build([
      line('1300', 121_000n),
      line('8000', -100_000n, { taxCode: 'WEG', taxRole: 'base' }),
      line('1500', -21_000n, { taxCode: 'WEG', taxRole: 'tax' }),
    ])

    expect(result.blocked).toBe(true)
    const unknown = result.findings.find((entry) => entry.code === 'unknown_tax_code')
    expect(unknown?.severity).toBe('blocking')
    expect(unknown?.lines).toHaveLength(2)

    // And the control account names the money that never reached a rubriek.
    const payable = result.reconciliation.find((entry) => entry.accountNumber === '1500')
    expect(payable?.differenceMinorUnits).toBe(-21_000n)
    expect(result.findings.some((entry) => entry.code === 'control_account_difference')).toBe(true)
  })

  it('blocks when the code exists but not on the booking date', () => {
    const result = build([
      line('1300', 121_000n, { bookingDate: '2025-11-30' }),
      line('8000', -100_000n, { taxCode: 'H21', taxRole: 'base', bookingDate: '2025-11-30' }),
      line('1500', -21_000n, { taxCode: 'H21', taxRole: 'tax', bookingDate: '2025-11-30' }),
    ])

    expect(result.blocked).toBe(true)
    expect(result.findings.some((entry) => entry.code === 'no_rule_in_force')).toBe(true)
    expect(result.findings.some((entry) => entry.code === 'unknown_tax_code')).toBe(false)
  })

  it('blocks when VAT is posted under a zero-rate code', () => {
    const result = build([
      line('1300', 100_000n),
      line('8000', -79_000n, { taxCode: 'ICP', taxRole: 'base' }),
      line('1500', -21_000n, { taxCode: 'ICP', taxRole: 'tax' }),
    ])

    expect(result.blocked).toBe(true)
    const finding = result.findings.find((entry) => entry.code === 'code_declares_no_vat')
    expect(finding?.severity).toBe('blocking')
    expect(finding?.amountMinorUnits).toBe(-21_000n)
  })

  it('reports an untagged control account movement without blocking on it', () => {
    // Paying the previous quarter's aangifte. Legitimate, and indistinguishable
    // from VAT booked by hand, so it is shown rather than judged.
    const result = build([...domesticSale(), line('1500', 18_000n), line('1100', -18_000n)])

    expect(result.blocked).toBe(false)
    const finding = result.findings.find((entry) => entry.code === 'untagged_control_movement')
    expect(finding?.severity).toBe('warning')
    expect(finding?.amountMinorUnits).toBe(18_000n)

    const payable = result.reconciliation.find((entry) => entry.accountNumber === '1500')
    expect(payable?.untaggedMovementMinorUnits).toBe(18_000n)
    // The payment is not a difference: the tagged movement still reconciles.
    expect(payable?.differenceMinorUnits).toBe(0n)
  })

  it('warns when a rubriek declares VAT its own base and rate do not produce', () => {
    const result = build([
      line('1300', 121_000n),
      line('8000', -100_000n, { taxCode: 'H21', taxRole: 'base' }),
      line('1500', -12_000n, { taxCode: 'H21', taxRole: 'tax' }),
      // Balanced by a hand-typed correction somewhere the return cannot see.
      line('4900', -9_000n),
    ])

    const finding = result.findings.find((entry) => entry.code === 'rate_mismatch')
    expect(finding?.severity).toBe('warning')
    expect(finding?.amountMinorUnits).toBe(-9_000n)
    expect(result.blocked).toBe(false)
  })

  it('tolerates per-line rounding without crying rate mismatch', () => {
    // Three lines at 21%, each rounded, summing to a cent off the rubriek rate.
    const result = build([
      line('1300', 40_361n),
      line('8000', -11_111n, { taxCode: 'H21', taxRole: 'base' }),
      line('8010', -11_111n, { taxCode: 'H21', taxRole: 'base' }),
      line('8000', -11_111n, { taxCode: 'H21', taxRole: 'base' }),
      line('1500', -7_002n, { taxCode: 'H21', taxRole: 'tax' }),
    ])

    expect(result.findings.some((entry) => entry.code === 'rate_mismatch')).toBe(false)
  })

  it('leaves a period with no VAT at all entirely empty rather than blocked', () => {
    const result = build([line('1100', 50_000n), line('0500', -50_000n)])

    expect(result.owedMinorUnits).toBe(0n)
    expect(result.payableMinorUnits).toBe(0n)
    expect(result.findings).toEqual([])
    expect(result.blocked).toBe(false)
  })
})

describe('presentVatReturn', () => {
  it('renders every box in form order with the subtotals filled in', () => {
    const result = build([
      ...domesticSale(),
      line('4400', 50_000n, { taxCode: 'VH21', taxRole: 'base' }),
      line('1510', 10_500n, { taxCode: 'VH21', taxRole: 'tax' }),
      line('1600', -60_500n),
    ])

    const rows = presentVatReturn(result)
    expect(rows.map((row) => row.rubriek.id)).toEqual([
      '1a',
      '1b',
      '1c',
      '1d',
      '1e',
      '2a',
      '3a',
      '3b',
      '3c',
      '4a',
      '4b',
      '5a',
      '5b',
      '5c',
    ])

    const box = (id: string) => rows.find((row) => row.rubriek.id === id)
    expect(box('5a')?.vatMinorUnits).toBe(21_000n)
    expect(box('5b')?.vatMinorUnits).toBe(10_500n)
    expect(box('5c')?.vatMinorUnits).toBe(10_500n)
  })
})
