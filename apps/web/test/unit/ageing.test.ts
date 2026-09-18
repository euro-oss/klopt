import { describe, expect, it } from 'vitest'
import { bucketFor, debtorAgeing, type OverdueInvoice } from '../../src/lib/ageing.js'

/**
 * Aged debtors, bucketed by how late an invoice is.
 *
 * The same rule the creditor side uses, on the open items the dunning queue
 * already reads — amounts net of what the bank has been allocated to them, so
 * a partly paid invoice ages by what is left rather than by what was sent.
 */

const invoice = (
  contactName: string,
  daysOverdue: number,
  total: string,
  number = 'F-1',
): OverdueInvoice => ({
  id: `${contactName}-${number}-${String(daysOverdue)}`,
  number,
  dueDate: '2026-01-31',
  total,
  contactName,
  daysOverdue,
})

describe('which bucket an overdue invoice falls in', () => {
  it('counts days past the due date', () => {
    expect(bucketFor(0)).toBe('upTo30')
    expect(bucketFor(30)).toBe('upTo30')
    expect(bucketFor(31)).toBe('upTo60')
    expect(bucketFor(60)).toBe('upTo60')
    expect(bucketFor(61)).toBe('upTo90')
    expect(bucketFor(90)).toBe('upTo90')
    expect(bucketFor(91)).toBe('over90')
  })
})

describe('the debtor ageing', () => {
  it('is empty when nothing is overdue', () => {
    expect(debtorAgeing([])).toEqual({
      rows: [],
      totals: { upTo30: '0', upTo60: '0', upTo90: '0', over90: '0', total: '0' },
    })
  })

  it('gathers a customer’s invoices into one line', () => {
    const [row] = debtorAgeing([
      invoice('Grote Klant N.V.', 10, '100000', 'F-1'),
      invoice('Grote Klant N.V.', 45, '50000', 'F-2'),
    ]).rows

    expect(row).toMatchObject({
      contactName: 'Grote Klant N.V.',
      upTo30: '100000',
      upTo60: '50000',
      upTo90: '0',
      over90: '0',
      total: '150000',
      oldestDays: 45,
    })
  })

  it('puts the worst payer first', () => {
    // The reason to open this screen is to find out who to chase. An
    // alphabetical list makes that a search rather than a glance.
    const ageing = debtorAgeing([
      invoice('Aardige Klant', 5, '1000'),
      invoice('Zeer Late Klant', 200, '1000'),
    ])

    expect(ageing.rows.map((row) => row.contactName)).toEqual(['Zeer Late Klant', 'Aardige Klant'])
  })

  it('adds up each column and the whole report', () => {
    const ageing = debtorAgeing([
      invoice('A', 10, '1000'),
      invoice('B', 100, '2000'),
      invoice('C', 100, '3000'),
    ])

    expect(ageing.totals).toEqual({
      upTo30: '1000',
      upTo60: '0',
      upTo90: '0',
      over90: '5000',
      total: '6000',
    })
  })

  it('keeps amounts in minor units the whole way, never in a float', () => {
    // A cent lost to binary floating point in a receivables report is a cent
    // an accountant spends an afternoon looking for.
    const ageing = debtorAgeing([
      invoice('A', 1, '10'),
      invoice('B', 1, '20'),
      invoice('C', 1, '92233720368547758070'),
    ])

    expect(ageing.totals.total).toBe('92233720368547758100')
  })
})
