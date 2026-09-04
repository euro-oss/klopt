import { describe, expect, it } from 'vitest'
import { LedgerError } from '../../src/errors.js'
import {
  dueDate,
  lineNet,
  priceInvoice,
  taxOn,
  type InvoiceLineInput,
  type TaxCodeSnapshot,
} from '../../src/sales/pricing.js'
import { buildInvoiceEntry } from '../../src/sales/posting.js'

const HIGH: TaxCodeSnapshot = {
  id: 'tax-h',
  code: 'H21',
  description: 'BTW hoog',
  rateBasisPoints: 2100,
  isReverseCharge: false,
  ublCategory: 'S',
}

const LOW: TaxCodeSnapshot = {
  id: 'tax-l',
  code: 'L9',
  description: 'BTW laag',
  rateBasisPoints: 900,
  isReverseCharge: false,
  ublCategory: 'S',
}

const ZERO: TaxCodeSnapshot = {
  id: 'tax-z',
  code: 'VERL',
  description: 'BTW verlegd',
  rateBasisPoints: 0,
  isReverseCharge: true,
  ublCategory: 'AE',
}

const CODES = new Map([HIGH, LOW, ZERO].map((code) => [code.code, code]))

function line(overrides: Partial<InvoiceLineInput> = {}): InvoiceLineInput {
  return {
    description: 'Advies',
    quantity: '1',
    unitCode: 'EA',
    unitPrice: 100_00n,
    revenueAccountNumber: '8000',
    taxCode: 'H21',
    ...overrides,
  }
}

describe('line arithmetic', () => {
  it('multiplies quantity by price without a float', () => {
    expect(lineNet('1', 100_00n)).toBe(10_000n)
    expect(lineNet('2.5', 100_00n)).toBe(25_000n)
    expect(lineNet('0.25', 99_99n)).toBe(2500n)
    // 1.15 × 100 is 114.99999999999999 in a float. Not here.
    expect(lineNet('1.15', 100_00n)).toBe(11_500n)
  })

  it('rounds half up', () => {
    // 0.005 of a euro rounds to a cent, not away.
    expect(lineNet('0.5', 1n)).toBe(1n)
    expect(lineNet('0.4', 1n)).toBe(0n)
  })

  it('survives quantities and prices no float could hold', () => {
    expect(lineNet('1000000', 92_233_720_368_547n)).toBe(92_233_720_368_547_000_000n)
  })

  it('applies a rate in basis points', () => {
    expect(taxOn(100_00n, 2100)).toBe(21_00n)
    expect(taxOn(33_33n, 2100)).toBe(700n)
    expect(taxOn(100_00n, 0)).toBe(0n)
  })

  it('refuses a quantity that is not a number', () => {
    expect(() => lineNet('twee', 100n)).toThrow(LedgerError)
    expect(() => lineNet('1,5', 100n)).toThrow(LedgerError)
  })
})

describe('VAT rounding is a policy, and the two policies differ', () => {
  // Three lines of 33.33 at 21%: 7.00 each is 21.00, but 21% of 99.99 is 20.998
  // which rounds to 21.00 as well. 33.34 makes the difference visible.
  const lines = [
    line({ unitPrice: 33_34n }),
    line({ unitPrice: 33_34n }),
    line({ unitPrice: 33_34n }),
  ]

  it('per line rounds each line and sums', () => {
    const priced = priceInvoice(lines, CODES, 'per_line')
    // 21% of 33.34 is 7.0014 -> 7.00, three times.
    expect(priced.lines.map((item) => item.tax_)).toEqual([700n, 700n, 700n])
    expect(priced.tax).toBe(2100n)
  })

  it('per invoice rounds the total once', () => {
    const priced = priceInvoice(lines, CODES, 'per_invoice')
    // 21% of 100.02 is 21.0042 -> 21.00. Same here, but the route differs.
    expect(priced.net).toBe(100_02n)
    expect(priced.tax).toBe(2100n)
    // The per-line figures are shares of the total and still sum to it.
    expect(priced.lines.reduce((sum, item) => sum + item.tax_, 0n)).toBe(priced.tax)
  })

  it('gives genuinely different totals where the rounding bites', () => {
    // 0.10 at 9% is 0.009: a cent per line rounded up, nothing rounded once.
    const pennies = Array.from({ length: 5 }, () => line({ unitPrice: 10n, taxCode: 'L9' }))

    expect(priceInvoice(pennies, CODES, 'per_line').tax).toBe(5n)
    // 9% of 0.50 is 0.045 -> 0.05... still 5. Push it further.
    const morePennies = Array.from({ length: 3 }, () => line({ unitPrice: 10n, taxCode: 'L9' }))
    expect(priceInvoice(morePennies, CODES, 'per_line').tax).toBe(3n)
    expect(priceInvoice(morePennies, CODES, 'per_invoice').tax).toBe(3n)

    // 1 cent at 21%, ten times: 0.0021 rounds to 0 per line, 0.021 rounds to 2
    // on the total. That is the difference an accountant notices.
    const cents = Array.from({ length: 10 }, () => line({ unitPrice: 1n }))
    expect(priceInvoice(cents, CODES, 'per_line').tax).toBe(0n)
    expect(priceInvoice(cents, CODES, 'per_invoice').tax).toBe(2n)
  })

  it('always has the line shares sum to the group, under either policy', () => {
    for (const rounding of ['per_line', 'per_invoice'] as const) {
      const priced = priceInvoice(
        [
          line({ unitPrice: 33_33n }),
          line({ unitPrice: 66_67n }),
          line({ unitPrice: 10n, taxCode: 'L9' }),
          line({ unitPrice: 1n, taxCode: 'L9' }),
        ],
        CODES,
        rounding,
      )

      for (const group of priced.taxGroups) {
        const share = priced.lines
          .filter((item) => item.tax.code === group.tax.code)
          .reduce((sum, item) => sum + item.tax_, 0n)
        expect(share, `${rounding} ${group.tax.code}`).toBe(group.amount)
      }
      expect(priced.total).toBe(priced.net + priced.tax)
    }
  })
})

describe('tax groups', () => {
  it('groups by code, which is what UBL reports', () => {
    const priced = priceInvoice(
      [
        line({ unitPrice: 100_00n }),
        line({ unitPrice: 50_00n, taxCode: 'L9' }),
        line({ unitPrice: 25_00n }),
      ],
      CODES,
      'per_invoice',
    )

    expect(priced.taxGroups).toHaveLength(2)
    const high = priced.taxGroups.find((group) => group.tax.code === 'H21')
    expect(high?.net).toBe(125_00n)
    expect(high?.amount).toBe(26_25n)
    const low = priced.taxGroups.find((group) => group.tax.code === 'L9')
    expect(low?.net).toBe(50_00n)
    expect(low?.amount).toBe(450n)
    expect(priced.total).toBe(205_75n)
  })

  it('keeps a zero-rated group, because UBL needs the category on the invoice', () => {
    const priced = priceInvoice([line({ taxCode: 'VERL' })], CODES, 'per_invoice')
    expect(priced.taxGroups).toHaveLength(1)
    expect(priced.taxGroups[0]?.amount).toBe(0n)
    expect(priced.taxGroups[0]?.tax.ublCategory).toBe('AE')
    expect(priced.total).toBe(100_00n)
  })

  it('refuses an unknown tax code, naming it', () => {
    expect(() => priceInvoice([line({ taxCode: 'NOPE' })], CODES, 'per_invoice')).toThrow(/NOPE/)
  })

  it('refuses an empty invoice', () => {
    expect(() => priceInvoice([], CODES, 'per_invoice')).toThrow(LedgerError)
  })
})

describe('due dates', () => {
  it('adds the payment terms', () => {
    expect(dueDate('2026-01-20', 30)).toBe('2026-02-19')
    expect(dueDate('2026-01-20', 0)).toBe('2026-01-20')
  })

  it('crosses a year boundary and a leap day', () => {
    expect(dueDate('2026-12-20', 30)).toBe('2027-01-19')
    expect(dueDate('2028-02-28', 1)).toBe('2028-02-29')
  })
})

describe('the journal entry an invoice posts', () => {
  const request = {
    entityId: 'entity-1',
    journalCode: 'VRK',
    bookingDate: '2026-01-20',
    documentDate: '2026-01-20',
    invoiceNumber: '2026-0001',
    contactNumber: 'DEB-0001',
    contactName: 'Klant B.V.',
    contactId: 'contact-1',
    receivableAccountNumber: '1300',
    isCreditNote: false,
    reference: null,
    currency: 'EUR',
  }

  const taxAccounts = (code: string) => (code === 'H21' ? '1500' : code === 'L9' ? '1501' : null)

  it('debits the debtor for the gross and credits revenue and BTW', () => {
    const priced = priceInvoice([line({ unitPrice: 100_00n })], CODES, 'per_invoice')
    const command = buildInvoiceEntry(request, priced, taxAccounts)

    expect(command.lines).toHaveLength(3)
    const receivable = command.lines[0]!
    expect(receivable.accountNumber).toBe('1300')
    expect(receivable.debit).toBe(121_00n)
    // The subledger link is what makes the debtors ledger and, in M2, bank
    // matching possible.
    expect(receivable.subledgerKind).toBe('customer')
    expect(receivable.subledgerId).toBe('contact-1')

    expect(command.lines.find((item) => item.accountNumber === '8000')?.credit).toBe(100_00n)
    expect(command.lines.find((item) => item.accountNumber === '1500')?.credit).toBe(21_00n)
  })

  it('balances, always', () => {
    const priced = priceInvoice(
      [
        line({ unitPrice: 33_33n }),
        line({ unitPrice: 50_00n, taxCode: 'L9', revenueAccountNumber: '8010' }),
        line({ unitPrice: 12_34n, taxCode: 'VERL' }),
      ],
      CODES,
      'per_invoice',
    )
    const command = buildInvoiceEntry(request, priced, taxAccounts)

    const net = command.lines.reduce((total, item) => total + item.debit - item.credit, 0n)
    expect(net).toBe(0n)
  })

  it('collapses several lines on one revenue account into one journal line', () => {
    const priced = priceInvoice(
      [line({ unitPrice: 10_00n }), line({ unitPrice: 20_00n }), line({ unitPrice: 30_00n })],
      CODES,
      'per_invoice',
    )
    const command = buildInvoiceEntry(request, priced, taxAccounts)

    const revenue = command.lines.filter((item) => item.accountNumber === '8000')
    expect(revenue).toHaveLength(1)
    expect(revenue[0]?.credit).toBe(60_00n)
  })

  it('swaps every side for a credit note', () => {
    const priced = priceInvoice([line({ unitPrice: 100_00n })], CODES, 'per_invoice')
    const command = buildInvoiceEntry({ ...request, isCreditNote: true }, priced, taxAccounts)

    expect(command.lines[0]?.credit).toBe(121_00n)
    expect(command.lines[0]?.debit).toBe(0n)
    expect(command.lines.find((item) => item.accountNumber === '8000')?.debit).toBe(100_00n)
    expect(command.description).toContain('Creditnota')

    const net = command.lines.reduce((total, item) => total + item.debit - item.credit, 0n)
    expect(net).toBe(0n)
  })

  it('omits a zero tax group rather than posting a zero line', () => {
    const priced = priceInvoice([line({ taxCode: 'VERL' })], CODES, 'per_invoice')
    const command = buildInvoiceEntry(request, priced, taxAccounts)

    expect(command.lines).toHaveLength(2)
    expect(command.lines.every((item) => item.debit > 0n || item.credit > 0n)).toBe(true)
  })

  it('refuses to post when a tax code has no account, naming the code', () => {
    const priced = priceInvoice([line({ taxCode: 'L9' })], CODES, 'per_invoice')
    expect(() => buildInvoiceEntry(request, priced, () => null)).toThrow(/L9/)
  })

  it('refuses an invoice totalling nothing', () => {
    const priced = priceInvoice([line({ unitPrice: 0n })], CODES, 'per_invoice')
    expect(() => buildInvoiceEntry(request, priced, taxAccounts)).toThrow(LedgerError)
  })
})
