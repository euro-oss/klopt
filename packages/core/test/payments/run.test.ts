import { describe, expect, it } from 'vitest'
import {
  assertRunnable,
  planPaymentRun,
  type PayableItem,
  type PayableSupplier,
} from '../../src/index.js'

/**
 * Turning approved invoices into payments.
 *
 * The case that shapes the whole design is a credit note: there is no such thing
 * as a payment of minus 210,00, so a credit has to be netted against something
 * before any money moves — which is why the unit is the supplier rather than the
 * invoice, however much nicer one-payment-per-invoice would be for the
 * supplier's own reconciliation.
 */

function item(overrides: Partial<PayableItem> = {}): PayableItem {
  return {
    invoiceId: 'invoice-1',
    supplierInvoiceNumber: 'F-2026-0042',
    kind: 'invoice',
    dueDate: '2026-03-12',
    outstandingMinorUnits: 121_000n,
    paymentReference: null,
    currency: 'EUR',
    ...overrides,
  }
}

function supplier(overrides: Partial<PayableSupplier> = {}): PayableSupplier {
  return {
    contactId: 'contact-1',
    contactNumber: 'CRE-0001',
    contactName: 'Leverancier B.V.',
    iban: 'NL02ABNA0123456789',
    bic: 'ABNANL2A',
    items: [item()],
    ...overrides,
  }
}

const plan = (suppliers: readonly PayableSupplier[], currency = 'EUR') =>
  planPaymentRun({ suppliers, currency, batchReference: 'BATCH-2026-04-01' })

describe('planPaymentRun', () => {
  it('makes one instruction per supplier, settling their open invoices', () => {
    const result = plan([supplier()])

    expect(result.instructions).toHaveLength(1)
    expect(result.instructions[0]).toMatchObject({
      creditorName: 'Leverancier B.V.',
      creditorIban: 'NL02ABNA0123456789',
      amountMinorUnits: 121_000n,
      remittanceInformation: 'F-2026-0042',
    })
    expect(result.totalMinorUnits).toBe(121_000n)
    expect(result.findings).toEqual([])
  })

  it('records which documents each instruction settles', () => {
    // What lets a returned payment be traced back to the invoices it was meant
    // to clear, and what stops a paid invoice rejoining the next run.
    const result = plan([
      supplier({
        items: [
          item({ invoiceId: 'a', supplierInvoiceNumber: 'F-1', outstandingMinorUnits: 100_00n }),
          item({
            invoiceId: 'b',
            supplierInvoiceNumber: 'F-2',
            outstandingMinorUnits: 50_00n,
            dueDate: '2026-03-20',
          }),
        ],
      }),
    ])

    expect(result.instructions[0]?.amountMinorUnits).toBe(150_00n)
    expect(result.instructions[0]?.allocations).toEqual([
      { invoiceId: 'a', supplierInvoiceNumber: 'F-1', kind: 'invoice', amountMinorUnits: 100_00n },
      { invoiceId: 'b', supplierInvoiceNumber: 'F-2', kind: 'invoice', amountMinorUnits: 50_00n },
    ])
    expect(result.instructions[0]?.remittanceInformation).toBe('F-1, F-2')
  })

  it('nets a credit note against the oldest invoice', () => {
    // The reason the unit is the supplier: 1.210,00 invoiced and 210,00 credited
    // is one payment of 1.000,00, because minus 210,00 is not a payment.
    const result = plan([
      supplier({
        items: [
          item({ invoiceId: 'a', supplierInvoiceNumber: 'F-1', outstandingMinorUnits: 121_000n }),
          item({
            invoiceId: 'c',
            supplierInvoiceNumber: 'CN-1',
            kind: 'credit_note',
            outstandingMinorUnits: 21_000n,
            dueDate: '2026-03-20',
          }),
        ],
      }),
    ])

    expect(result.instructions).toHaveLength(1)
    expect(result.instructions[0]?.amountMinorUnits).toBe(100_000n)
    // Both documents are settled: the invoice by 100.000 of cash and 21.000 of
    // credit, the credit note in full. Neither comes back in the next run.
    expect(result.instructions[0]?.allocations).toEqual([
      { invoiceId: 'a', supplierInvoiceNumber: 'F-1', kind: 'invoice', amountMinorUnits: 121_000n },
      {
        invoiceId: 'c',
        supplierInvoiceNumber: 'CN-1',
        kind: 'credit_note',
        amountMinorUnits: 21_000n,
      },
    ])
    // And the remittance names both documents, so the supplier can see why.
    expect(result.instructions[0]?.remittanceInformation).toBe('F-1, CN-1')
  })

  it('spends a credit note across two invoices, oldest first', () => {
    const result = plan([
      supplier({
        items: [
          item({ invoiceId: 'a', supplierInvoiceNumber: 'F-1', outstandingMinorUnits: 100_00n }),
          item({
            invoiceId: 'b',
            supplierInvoiceNumber: 'F-2',
            outstandingMinorUnits: 100_00n,
            dueDate: '2026-03-20',
          }),
          item({
            invoiceId: 'c',
            supplierInvoiceNumber: 'CN-1',
            kind: 'credit_note',
            outstandingMinorUnits: 150_00n,
            dueDate: '2026-03-25',
          }),
        ],
      }),
    ])

    expect(result.instructions[0]?.amountMinorUnits).toBe(50_00n)
    // All three documents are settled. Leaving F-2 open because the cash only
    // reached F-1 would pay it again next week, on top of the credit.
    expect(result.instructions[0]?.allocations).toEqual([
      { invoiceId: 'a', supplierInvoiceNumber: 'F-1', kind: 'invoice', amountMinorUnits: 100_00n },
      { invoiceId: 'b', supplierInvoiceNumber: 'F-2', kind: 'invoice', amountMinorUnits: 100_00n },
      {
        invoiceId: 'c',
        supplierInvoiceNumber: 'CN-1',
        kind: 'credit_note',
        amountMinorUnits: 150_00n,
      },
    ])
  })

  it('says nothing to pay when the credits cancel out exactly', () => {
    const result = plan([
      supplier({
        items: [
          item({ outstandingMinorUnits: 121_000n }),
          item({
            invoiceId: 'c',
            supplierInvoiceNumber: 'CN-1',
            kind: 'credit_note',
            outstandingMinorUnits: 121_000n,
          }),
        ],
      }),
    ])

    expect(result.instructions).toEqual([])
    const finding = result.findings.find((entry) => entry.code === 'nothing_owed')
    // Not a problem. Nothing wrong happened.
    expect(finding?.severity).toBe('note')
  })

  it('calls a net credit a refund to ask for, not a payment to send', () => {
    const result = plan([
      supplier({
        items: [
          item({ outstandingMinorUnits: 100_00n }),
          item({
            invoiceId: 'c',
            supplierInvoiceNumber: 'CN-1',
            kind: 'credit_note',
            outstandingMinorUnits: 150_00n,
          }),
        ],
      }),
    ])

    expect(result.instructions).toEqual([])
    const finding = result.findings.find((entry) => entry.code === 'credit_exceeds_invoices')
    expect(finding?.severity).toBe('note')
    expect(finding?.amountMinorUnits).toBe(50_00n)
    expect(finding?.message).toContain('refund')
  })

  it('keeps the structured reference when exactly one invoice is settled', () => {
    // The common case, and the one where the supplier's own reconciliation is
    // automatic. A structured remittance carries exactly one value.
    const result = plan([supplier({ items: [item({ paymentReference: '0123456789012345' })] })])
    expect(result.instructions[0]?.remittanceReference).toBe('0123456789012345')
  })

  it('drops the structured reference when several documents are settled', () => {
    const result = plan([
      supplier({
        items: [
          item({ invoiceId: 'a', supplierInvoiceNumber: 'F-1', paymentReference: 'REF-1' }),
          item({
            invoiceId: 'b',
            supplierInvoiceNumber: 'F-2',
            paymentReference: 'REF-2',
            dueDate: '2026-03-20',
          }),
        ],
      }),
    ])

    // There is nowhere to put two. Sending one of them would be worse than
    // sending neither: the supplier would mark the wrong invoice paid.
    expect(result.instructions[0]?.remittanceReference).toBeNull()
    expect(result.instructions[0]?.remittanceInformation).toBe('F-1, F-2')
  })

  it('blocks a supplier with no IBAN, naming what is owed', () => {
    const result = plan([supplier({ iban: null })])

    expect(result.instructions).toEqual([])
    const finding = result.findings.find((entry) => entry.code === 'no_iban')
    expect(finding?.severity).toBe('blocking')
    expect(finding?.amountMinorUnits).toBe(121_000n)
  })

  it('blocks a mistyped IBAN before the bank refuses the whole batch', () => {
    const result = plan([supplier({ iban: 'NL02ABNA0123456780' })])
    expect(result.findings.find((entry) => entry.code === 'invalid_iban')?.severity).toBe(
      'blocking',
    )
  })

  it('normalises the IBAN it sends', () => {
    const result = plan([supplier({ iban: 'nl02 abna 0123 4567 89' })])
    expect(result.instructions[0]?.creditorIban).toBe('NL02ABNA0123456789')
  })

  it('refuses a supplier whose documents are in another currency', () => {
    // A pain.001 batch carries one currency. Quietly paying euros for a dollar
    // invoice would be a different amount than the one owed.
    const result = plan([supplier({ items: [item({ currency: 'USD' })] })])
    expect(result.findings.find((entry) => entry.code === 'mixed_currencies')?.severity).toBe(
      'blocking',
    )
    expect(result.instructions).toEqual([])
  })

  it('gives every instruction a unique end-to-end id within the batch', () => {
    // A bank may read two identical ones as one duplicated payment.
    const result = plan([
      supplier(),
      supplier({ contactId: 'contact-2', contactNumber: 'CRE-0002', contactName: 'Ander B.V.' }),
    ])

    const ids = result.instructions.map((entry) => entry.endToEndId)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => id.length <= 35)).toBe(true)
  })

  it('builds the same run twice identically', () => {
    // Stable end-to-end ids, so a rebuilt run is not two payments the bank
    // cannot tell apart.
    const first = plan([supplier()])
    const second = plan([supplier()])
    expect(first.instructions[0]?.endToEndId).toBe(second.instructions[0]?.endToEndId)
  })

  it('sorts by what is due first', () => {
    const result = plan([
      supplier({
        contactNumber: 'CRE-0002',
        contactId: 'c2',
        items: [item({ dueDate: '2026-05-01' })],
      }),
      supplier({ contactNumber: 'CRE-0001', items: [item({ dueDate: '2026-03-01' })] }),
    ])
    expect(result.instructions.map((entry) => entry.contactNumber)).toEqual([
      'CRE-0001',
      'CRE-0002',
    ])
  })

  it('truncates a remittance that would not fit', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      item({
        invoiceId: `id-${String(index)}`,
        supplierInvoiceNumber: `FACTUUR-2026-${String(index).padStart(4, '0')}`,
        outstandingMinorUnits: 100n,
      }),
    )
    const result = plan([supplier({ items: many })])

    expect(result.instructions[0]?.remittanceInformation.length).toBeLessThanOrEqual(140)
    expect(result.instructions[0]?.remittanceInformation).toMatch(/…$/)
    // The allocations are complete even when the description cannot be.
    expect(result.instructions[0]?.allocations).toHaveLength(40)
  })

  it('plans the payable suppliers and reports the rest, in one pass', () => {
    const result = plan([
      supplier(),
      supplier({ contactId: 'c2', contactNumber: 'CRE-0002', iban: null }),
      supplier({
        contactId: 'c3',
        contactNumber: 'CRE-0003',
        items: [
          item({ outstandingMinorUnits: 100n }),
          item({ invoiceId: 'x', kind: 'credit_note', outstandingMinorUnits: 100n }),
        ],
      }),
    ])

    expect(result.instructions).toHaveLength(1)
    expect(result.findings.map((entry) => entry.code)).toEqual(['no_iban', 'nothing_owed'])
    expect(result.totalMinorUnits).toBe(121_000n)
  })
})

describe('assertRunnable', () => {
  it('says nothing about a run that can go out', () => {
    expect(() => {
      assertRunnable(plan([supplier()]))
    }).not.toThrow()
  })

  it('does not refuse a run because one supplier owes us', () => {
    // A net credit is a fact about that supplier, not a problem with the batch.
    // The others are still payable.
    const result = plan([
      supplier(),
      supplier({
        contactId: 'c2',
        contactNumber: 'CRE-0002',
        items: [item({ kind: 'credit_note', outstandingMinorUnits: 100n })],
      }),
    ])
    expect(() => {
      assertRunnable(result)
    }).not.toThrow()
  })

  it('throws with every blocked supplier at once', () => {
    const result = plan([
      supplier({ iban: null }),
      supplier({ contactId: 'c2', contactNumber: 'CRE-0002', iban: 'NL00BAD0000000000' }),
    ])

    let thrown: unknown
    try {
      assertRunnable(result)
    } catch (error: unknown) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: 'invalid_payment' })
    expect((thrown as { violations: readonly unknown[] }).violations).toHaveLength(2)
  })
})

describe('the allocation invariant', () => {
  /**
   * Every instruction's amount is what it settles: the invoices less the credit
   * notes, to the cent. If it were not, an invoice would be marked settled for
   * an amount nobody paid — or paid for an amount nobody recorded — and the
   * creditors subledger would stop agreeing with account 1600 from that moment.
   */
  it('holds for every shape of supplier', () => {
    const result = plan([
      supplier({
        contactId: 'c1',
        contactNumber: 'CRE-0001',
        items: [item({ invoiceId: 'a', outstandingMinorUnits: 121_000n })],
      }),
      supplier({
        contactId: 'c2',
        contactNumber: 'CRE-0002',
        items: [
          item({ invoiceId: 'b', outstandingMinorUnits: 100_00n }),
          item({ invoiceId: 'c', outstandingMinorUnits: 100_00n, dueDate: '2026-03-20' }),
          item({
            invoiceId: 'd',
            supplierInvoiceNumber: 'CN-1',
            kind: 'credit_note',
            outstandingMinorUnits: 150_00n,
            dueDate: '2026-03-25',
          }),
        ],
      }),
    ])

    expect(result.instructions).toHaveLength(2)
    for (const instruction of result.instructions) {
      const settled = instruction.allocations.reduce(
        (sum, allocation) =>
          allocation.kind === 'credit_note'
            ? sum - allocation.amountMinorUnits
            : sum + allocation.amountMinorUnits,
        0n,
      )
      expect(settled).toBe(instruction.amountMinorUnits)
    }
  })

  it('settles every document it netted, not only the ones the cash reached', () => {
    // The bug this guards: allocating the cash oldest-first would leave the
    // second invoice open, and next week it would be paid in full — 250,00 out
    // on 200,00 invoiced less a 150,00 credit.
    const result = plan([
      supplier({
        items: [
          item({ invoiceId: 'a', outstandingMinorUnits: 100_00n }),
          item({ invoiceId: 'b', outstandingMinorUnits: 100_00n, dueDate: '2026-03-20' }),
          item({
            invoiceId: 'c',
            supplierInvoiceNumber: 'CN-1',
            kind: 'credit_note',
            outstandingMinorUnits: 150_00n,
            dueDate: '2026-03-25',
          }),
        ],
      }),
    ])

    expect(result.instructions[0]?.allocations.map((entry) => entry.invoiceId)).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})
