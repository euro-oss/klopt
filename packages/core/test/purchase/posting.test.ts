import { describe, expect, it } from 'vitest'
import {
  buildPurchaseEntry,
  checkPurchaseInvoice,
  isBookable,
  type PurchaseInvoiceInput,
  type PurchaseLineInput,
  type TaxCodeRule,
} from '../../src/index.js'

/**
 * Booking a supplier's invoice.
 *
 * The arithmetic is the whole thing, and there are three cases that are not
 * "sales with the signs flipped": partly deductible VAT, wholly non-deductible
 * VAT, and a reverse charge where the entry posts VAT the supplier never
 * charged. Each is checked by the amounts *and* by the entry balancing, because
 * an unbalanced command is refused downstream and a test that only checks
 * amounts would let one through.
 */

function rule(code: string, overrides: Partial<TaxCodeRule> = {}): TaxCodeRule {
  return {
    code,
    description: code,
    rateBasisPoints: 2100,
    validFrom: '2020-01-01',
    validTo: null,
    direction: 'input',
    baseRubriek: null,
    vatRubriek: '5b',
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
  rule('VH21'),
  rule('VL9', { rateBasisPoints: 900 }),
  // Representation costs: half deductible, which is a real Dutch rule shape.
  rule('VH21-PRO', { deductibility: 'pro_rata', proRataBasisPoints: 5_000 }),
  rule('VH21-GEEN', { deductibility: 'none' }),
  // An intra-community acquisition and the code that carries its deduction.
  rule('ICV21', {
    baseRubriek: '4b',
    vatRubriek: '4b',
    scope: 'intra_community_acquisition',
    supplyKind: 'goods',
    deductionCode: 'ICV21-VOOR',
  }),
  rule('ICV21-VOOR', { scope: 'intra_community_acquisition' }),
  // The same, but self-assessing with no deduction code: a misconfiguration.
  rule('ICV21-LOS', {
    baseRubriek: '4b',
    vatRubriek: '4b',
    scope: 'intra_community_acquisition',
    supplyKind: 'goods',
  }),
  // Output codes must not be usable on a purchase.
  rule('H21', { direction: 'output', baseRubriek: '1a', vatRubriek: '1a' }),
]

const ACCOUNTS: Readonly<Record<string, string>> = {
  VH21: '1510',
  VL9: '1510',
  'VH21-PRO': '1510',
  'VH21-GEEN': '1510',
  ICV21: '1500',
  'ICV21-VOOR': '1510',
  'ICV21-LOS': '1500',
}

const taxAccountFor = (code: string): string | null => ACCOUNTS[code] ?? null

function line(overrides: Partial<PurchaseLineInput> = {}): PurchaseLineInput {
  return {
    description: 'Kantoorartikelen',
    accountNumber: '4400',
    taxCode: 'VH21',
    netMinorUnits: 100_000n,
    taxMinorUnits: 21_000n,
    ...overrides,
  }
}

function invoice(overrides: Partial<PurchaseInvoiceInput> = {}): PurchaseInvoiceInput {
  const lines = overrides.lines ?? [line()]
  const net = lines.reduce((sum, entry) => sum + entry.netMinorUnits, 0n)
  const tax = lines.reduce((sum, entry) => sum + entry.taxMinorUnits, 0n)
  return {
    supplierInvoiceNumber: 'F-2026-0042',
    kind: 'invoice',
    invoiceDate: '2026-02-10',
    dueDate: '2026-03-12',
    currency: 'EUR',
    netMinorUnits: net,
    taxMinorUnits: tax,
    totalMinorUnits: net + tax,
    ...overrides,
    lines,
  }
}

function entryFor(input: PurchaseInvoiceInput) {
  return buildPurchaseEntry(
    {
      entityId: 'entity',
      journalCode: 'INK',
      bookingDate: '2026-02-11',
      contactNumber: 'CRE-0001',
      contactName: 'Leverancier B.V.',
      contactId: 'contact-1',
      payableAccountNumber: '1600',
      invoice: input,
    },
    RULES,
    taxAccountFor,
  )
}

/** Debits minus credits. Zero, or the ledger refuses it. */
function imbalance(command: ReturnType<typeof entryFor>): bigint {
  return command.lines.reduce((sum, entry) => sum + entry.debit - entry.credit, 0n)
}

function find(command: ReturnType<typeof entryFor>, accountNumber: string, taxRole?: string) {
  return command.lines.filter(
    (entry) =>
      entry.accountNumber === accountNumber && (taxRole === undefined || entry.taxRole === taxRole),
  )
}

describe('buildPurchaseEntry', () => {
  it('posts the cost, the voorbelasting and the creditor', () => {
    const command = entryFor(invoice())

    expect(imbalance(command)).toBe(0n)
    expect(command.lines).toHaveLength(3)

    const cost = find(command, '4400')[0]
    expect(cost).toMatchObject({ debit: 100_000n, credit: 0n, taxCode: 'VH21', taxRole: 'base' })
    // The deducted VAT travels on the base line, for the auditfile.
    expect(cost?.taxAmount).toBe(21_000n)

    const vat = find(command, '1510')[0]
    expect(vat).toMatchObject({ debit: 21_000n, taxCode: 'VH21', taxRole: 'tax' })

    const creditor = find(command, '1600')[0]
    expect(creditor).toMatchObject({
      credit: 121_000n,
      subledgerKind: 'supplier',
      subledgerId: 'contact-1',
    })
  })

  it('carries the supplier’s own number into the entry', () => {
    const command = entryFor(invoice())
    expect(command.sourceDocumentRef).toBe('F-2026-0042')
    expect(command.description).toContain('Inkoopfactuur F-2026-0042')
    // And the document date is the invoice's, not the booking date.
    expect(command.documentDate).toBe('2026-02-10')
    expect(command.bookingDate).toBe('2026-02-11')
  })

  it('posts what the supplier stated, even when our rate disagrees', () => {
    // 21% of 100,00 is 21,00 and this invoice says 21,05. The document is what
    // we owe and what we may deduct, so the document is what gets booked.
    const command = entryFor(invoice({ lines: [line({ taxMinorUnits: 21_050n })] }))

    expect(imbalance(command)).toBe(0n)
    expect(find(command, '1510')[0]?.debit).toBe(21_050n)
    expect(find(command, '1600')[0]?.credit).toBe(121_050n)
  })

  it('splits partly deductible VAT between voorbelasting and the cost', () => {
    // 50% of 21,00 is 10,50 deducted; the other 10,50 is cost.
    const command = entryFor(invoice({ lines: [line({ taxCode: 'VH21-PRO' })] }))

    expect(imbalance(command)).toBe(0n)
    expect(find(command, '1510')[0]?.debit).toBe(10_500n)

    const costs = find(command, '4400')
    expect(costs).toHaveLength(2)
    expect(costs[0]).toMatchObject({ debit: 100_000n, taxRole: 'base' })
    // The sunk half is on its own line and is *not* tagged: it is cost now, and
    // tagging it would put it in rubriek 5b.
    expect(costs[1]).toMatchObject({ debit: 10_500n, taxCode: null, taxRole: null })
    expect(costs[1]?.description).toContain('Niet-aftrekbare BTW')

    expect(find(command, '1600')[0]?.credit).toBe(121_000n)
  })

  it('puts wholly non-deductible VAT entirely into the cost', () => {
    const command = entryFor(invoice({ lines: [line({ taxCode: 'VH21-GEEN' })] }))

    expect(imbalance(command)).toBe(0n)
    // Nothing reaches the receivable account at all.
    expect(find(command, '1510')).toHaveLength(0)
    const costs = find(command, '4400')
    expect(costs.map((entry) => entry.debit)).toEqual([100_000n, 21_000n])
    // And the base line's tax amount is zero, because nothing was deducted.
    expect(costs[0]?.taxAmount).toBe(0n)
  })

  it('self-assesses a reverse charge the supplier never charged', () => {
    const command = entryFor(
      invoice({
        lines: [line({ accountNumber: '7000', taxCode: 'ICV21', taxMinorUnits: 0n })],
      }),
    )

    expect(imbalance(command)).toBe(0n)

    // The cost is the net; the supplier charged nothing.
    expect(find(command, '7000')[0]).toMatchObject({ debit: 100_000n, taxCode: 'ICV21' })
    // We owe it: credited to the payable control account under 4b's code.
    expect(find(command, '1500')[0]).toMatchObject({
      credit: 21_000n,
      taxCode: 'ICV21',
      taxRole: 'tax',
    })
    // And deduct it, under the *paired* code, because one code cannot declare
    // the same money as both owed and deductible.
    expect(find(command, '1510')[0]).toMatchObject({
      debit: 21_000n,
      taxCode: 'ICV21-VOOR',
      taxRole: 'tax',
    })
    // The creditor owes only the net.
    expect(find(command, '1600')[0]?.credit).toBe(100_000n)
  })

  it('refuses a self-assessing code with no deduction code, rather than losing the VAT', () => {
    expect(() =>
      entryFor(invoice({ lines: [line({ taxCode: 'ICV21-LOS', taxMinorUnits: 0n })] })),
    ).toThrow(/deduction code/)
  })

  it('collapses lines per account and tax code, but never across codes', () => {
    const command = entryFor(
      invoice({
        lines: [
          line({ netMinorUnits: 60_000n, taxMinorUnits: 12_600n }),
          line({ netMinorUnits: 40_000n, taxMinorUnits: 8_400n }),
          line({ taxCode: 'VL9', netMinorUnits: 10_000n, taxMinorUnits: 900n }),
        ],
      }),
    )

    expect(imbalance(command)).toBe(0n)
    const costs = find(command, '4400', 'base')
    // Two lines, not three and not one: the 21% pair collapsed, the 9% did not
    // join them, because rubriek 5b is derived from these lines.
    expect(costs).toHaveLength(2)
    expect(costs.map((entry) => [entry.taxCode, entry.debit])).toEqual([
      ['VH21', 100_000n],
      ['VL9', 10_000n],
    ])
    expect(find(command, '1600')[0]?.credit).toBe(131_900n)
  })

  it('reverses every side for a credit note', () => {
    const command = entryFor(invoice({ kind: 'credit_note' }))

    expect(imbalance(command)).toBe(0n)
    expect(find(command, '4400')[0]).toMatchObject({ credit: 100_000n, debit: 0n })
    expect(find(command, '1510')[0]).toMatchObject({ credit: 21_000n, debit: 0n })
    expect(find(command, '1600')[0]).toMatchObject({ debit: 121_000n, credit: 0n })
    expect(command.description).toContain('Creditnota')
  })

  it('reverses a partly deductible credit note too, sunk VAT and all', () => {
    const command = entryFor(
      invoice({ kind: 'credit_note', lines: [line({ taxCode: 'VH21-PRO' })] }),
    )

    expect(imbalance(command)).toBe(0n)
    const costs = find(command, '4400')
    expect(costs.map((entry) => entry.credit)).toEqual([100_000n, 10_500n])
    expect(find(command, '1510')[0]?.credit).toBe(10_500n)
    // The base line's tax amount flips sign with the document.
    expect(costs[0]?.taxAmount).toBe(-10_500n)
  })

  it('refuses an invoice for nothing', () => {
    expect(() =>
      entryFor(
        invoice({
          lines: [line({ netMinorUnits: 0n, taxMinorUnits: 0n })],
        }),
      ),
    ).toThrow(/posts nothing/)
  })

  it('refuses a tax code with no ledger account', () => {
    const withoutAccount = (code: string): string | null => (code === 'VH21' ? null : '1510')
    expect(() =>
      buildPurchaseEntry(
        {
          entityId: 'entity',
          journalCode: 'INK',
          bookingDate: '2026-02-11',
          contactNumber: 'CRE-0001',
          contactName: 'Leverancier B.V.',
          contactId: 'contact-1',
          payableAccountNumber: '1600',
          invoice: invoice(),
        },
        RULES,
        withoutAccount,
      ),
    ).toThrow(/no ledger account/)
  })
})

describe('the journal it produces feeds the BTW-aangifte', () => {
  it('tags the base and the tax so rubriek 5b can be derived', async () => {
    const { buildVatReturn } = await import('../../src/vat/index.js')
    const command = entryFor(invoice({ lines: [line({ taxCode: 'VH21-PRO' })] }))

    const vatReturn = buildVatReturn({
      periodFrom: '2026-01-01',
      periodTo: '2026-03-31',
      lines: command.lines.map((entry, index) => ({
        entryId: 'entry-1',
        entryNumber: '1',
        journalCode: 'INK',
        bookingDate: '2026-02-11',
        lineNumber: index + 1,
        accountNumber: entry.accountNumber,
        accountName: entry.accountNumber,
        description: entry.description ?? '',
        taxCode: entry.taxCode,
        taxRole: entry.taxRole,
        signedMinorUnits: entry.debit - entry.credit,
      })),
      rules: RULES,
      controlAccountNumbers: ['1500', '1510'],
    })

    // Only the deducted half reaches 5b. The sunk half is cost and stays out.
    expect(vatReturn.deductibleMinorUnits).toBe(10_500n)
    expect(vatReturn.blocked).toBe(false)
    expect(vatReturn.findings).toEqual([])
  })

  it('declares a reverse charge in 4b and 5b, netting to nothing', async () => {
    const { buildVatReturn } = await import('../../src/vat/index.js')
    const command = entryFor(
      invoice({ lines: [line({ accountNumber: '7000', taxCode: 'ICV21', taxMinorUnits: 0n })] }),
    )

    const vatReturn = buildVatReturn({
      periodFrom: '2026-01-01',
      periodTo: '2026-03-31',
      lines: command.lines.map((entry, index) => ({
        entryId: 'entry-1',
        entryNumber: '1',
        journalCode: 'INK',
        bookingDate: '2026-02-11',
        lineNumber: index + 1,
        accountNumber: entry.accountNumber,
        accountName: entry.accountNumber,
        description: entry.description ?? '',
        taxCode: entry.taxCode,
        taxRole: entry.taxRole,
        signedMinorUnits: entry.debit - entry.credit,
      })),
      rules: RULES,
      controlAccountNumbers: ['1500', '1510'],
    })

    const box4b = vatReturn.rubrieken.find((entry) => entry.rubriek.id === '4b')
    expect(box4b?.baseMinorUnits).toBe(100_000n)
    expect(box4b?.vatMinorUnits).toBe(21_000n)
    expect(vatReturn.owedMinorUnits).toBe(21_000n)
    expect(vatReturn.deductibleMinorUnits).toBe(21_000n)
    expect(vatReturn.payableMinorUnits).toBe(0n)
    expect(vatReturn.blocked).toBe(false)
  })
})

describe('checkPurchaseInvoice', () => {
  const check = (input: PurchaseInvoiceInput, isDuplicate = false) =>
    checkPurchaseInvoice({ invoice: input, rules: RULES, isDuplicate })

  it('says nothing about a faithful capture', () => {
    expect(check(invoice())).toEqual([])
    expect(isBookable(check(invoice()))).toBe(true)
  })

  it('blocks when the lines do not sum to the stated net', () => {
    const findings = check({ ...invoice(), netMinorUnits: 90_000n, totalMinorUnits: 111_000n })
    expect(findings.map((finding) => finding.code)).toContain('lines_do_not_sum_to_net')
    expect(isBookable(findings)).toBe(false)
  })

  it('blocks when net plus VAT is not the total', () => {
    const findings = check({ ...invoice(), totalMinorUnits: 120_000n })
    expect(findings.map((finding) => finding.code)).toContain('net_plus_tax_is_not_total')
  })

  it('warns about a rate that does not match, without refusing', () => {
    const findings = check(invoice({ lines: [line({ taxMinorUnits: 19_000n })] }))
    const mismatch = findings.find((finding) => finding.code === 'rate_mismatch')
    expect(mismatch?.severity).toBe('warning')
    expect(mismatch?.lineNumber).toBe(1)
    expect(isBookable(findings)).toBe(true)
  })

  it('tolerates a cent, because suppliers round per line and we do not', () => {
    expect(check(invoice({ lines: [line({ taxMinorUnits: 21_001n })] }))).toEqual([])
  })

  it('blocks a duplicate of the same supplier’s number', () => {
    const findings = check(invoice(), true)
    const duplicate = findings.find((finding) => finding.code === 'duplicate_invoice_number')
    expect(duplicate?.severity).toBe('blocking')
    expect(duplicate?.message).toContain('paid twice')
  })

  it('blocks a reverse charge invoice that nevertheless charges VAT', () => {
    // Either the supplier should not have charged it or the code is wrong, and
    // booking it would declare the same VAT twice.
    const findings = check(invoice({ lines: [line({ taxCode: 'ICV21' })] }))
    expect(findings.map((finding) => finding.code)).toContain('reverse_charge_with_tax')
    expect(isBookable(findings)).toBe(false)
  })

  it('accepts a reverse charge invoice with no VAT on it', () => {
    expect(check(invoice({ lines: [line({ taxCode: 'ICV21', taxMinorUnits: 0n })] }))).toEqual([])
  })

  it('blocks an output code on a purchase', () => {
    const findings = check(invoice({ lines: [line({ taxCode: 'H21' })] }))
    expect(findings[0]?.message).toContain('output code')
    expect(isBookable(findings)).toBe(false)
  })

  it('blocks a code nobody has configured, and one out of its window', () => {
    expect(check(invoice({ lines: [line({ taxCode: 'WEG' })] }))[0]?.code).toBe('unknown_tax_code')
    expect(check(invoice({ invoiceDate: '2019-06-01', dueDate: '2019-07-01' }))[0]?.code).toBe(
      'no_rule_in_force',
    )
  })

  it('notes what will happen to non-deductible VAT rather than staying silent', () => {
    // Not a problem — a consequence. The figure reaching 5b is smaller than the
    // VAT on the document and nobody should have to work out why.
    const none = check(invoice({ lines: [line({ taxCode: 'VH21-GEEN' })] }))
    expect(none.find((finding) => finding.code === 'not_deductible')?.severity).toBe('note')
    expect(isBookable(none)).toBe(true)

    const pro = check(invoice({ lines: [line({ taxCode: 'VH21-PRO' })] }))
    const note = pro.find((finding) => finding.code === 'pro_rata')
    expect(note?.severity).toBe('note')
    expect(note?.amountMinorUnits).toBe(10_500n)
    expect(note?.message).toContain('50.00%')
  })

  it('reports every problem at once, blocking first', () => {
    const findings = check(
      {
        ...invoice({ lines: [line({ taxMinorUnits: 19_000n }), line({ taxCode: 'WEG' })] }),
        totalMinorUnits: 1n,
      },
      true,
    )

    expect(findings.length).toBeGreaterThan(3)
    expect(findings[0]?.severity).toBe('blocking')
    expect(findings.at(-1)?.severity).not.toBe('blocking')
  })
})
