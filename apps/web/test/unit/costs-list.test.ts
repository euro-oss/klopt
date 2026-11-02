import { describe, expect, it } from 'vitest'
import {
  costsApprovalKind,
  costsPill,
  costsSegmentOf,
  countAwaitingApproval,
  countCostsSegments,
  daysBetweenIso,
  filterCostsInvoices,
  isCostsOverdue,
  overdueCostsInvoices,
  showCostsAddToBatch,
  showCostsApprove,
  showCostsDispute,
  sumCostsOutstanding,
  sumCostsTotals,
  type CostsInvoiceRow,
} from '../../src/lib/costs-list.js'

const row = (
  overrides: Partial<CostsInvoiceRow> & Pick<CostsInvoiceRow, 'id' | 'status'>,
): CostsInvoiceRow => ({
  kind: 'invoice',
  supplierInvoiceNumber: 'INK-DEMO-2025-0001',
  contactNumber: 'CRE-1',
  contactName: 'Telecom Fictief',
  invoiceDate: '2025-11-24',
  dueDate: '2025-12-24',
  total: '40731',
  outstanding: '0',
  scheduled: '0',
  payable: false,
  disputedReason: null,
  ...overrides,
})

describe('daysBetweenIso / isCostsOverdue', () => {
  it('uses an exclusive due-date boundary (not late on due date)', () => {
    const bill = row({ id: '1', status: 'approved', outstanding: '100', dueDate: '2026-03-01' })
    expect(isCostsOverdue(bill, '2026-03-01')).toBe(false)
    expect(isCostsOverdue(bill, '2026-03-02')).toBe(true)
    expect(daysBetweenIso('2026-03-01', '2026-03-02')).toBe(1)
  })

  it('ignores drafts, cancelled, and zero outstanding', () => {
    expect(
      isCostsOverdue(
        row({ id: 'd', status: 'draft', outstanding: '100', dueDate: '2020-01-01' }),
        '2026-01-01',
      ),
    ).toBe(false)
    expect(
      isCostsOverdue(
        row({ id: 'c', status: 'cancelled', outstanding: '100', dueDate: '2020-01-01' }),
        '2026-01-01',
      ),
    ).toBe(false)
    expect(
      isCostsOverdue(
        row({ id: 'p', status: 'approved', outstanding: '0', dueDate: '2020-01-01' }),
        '2026-01-01',
      ),
    ).toBe(false)
  })
})

describe('costsSegmentOf / countCostsSegments', () => {
  it('splits all / to-pay / paid; omits cancelled; drafts only in all', () => {
    const invoices = [
      row({ id: 'd1', status: 'draft', outstanding: '0' }),
      row({ id: 'o1', status: 'approved', outstanding: '12100' }),
      row({ id: 'p1', status: 'approved', outstanding: '0' }),
      row({ id: 'c1', status: 'cancelled', outstanding: '0' }),
    ]
    expect(costsSegmentOf(invoices[0]!)).toBe('all')
    expect(costsSegmentOf(invoices[1]!)).toBe('open')
    expect(costsSegmentOf(invoices[2]!)).toBe('paid')
    expect(costsSegmentOf(invoices[3]!)).toBeNull()
    expect(countCostsSegments(invoices)).toEqual({ all: 3, open: 1, paid: 1 })
  })
})

describe('filterCostsInvoices', () => {
  it('filters by tab, segment and query', () => {
    const invoices = [
      row({ id: 'a', status: 'booked', outstanding: '5000', contactName: 'Alpha Demo' }),
      row({ id: 'b', status: 'approved', outstanding: '1000', contactName: 'Beta Demo' }),
      row({ id: 'c', status: 'approved', outstanding: '0', contactName: 'Alpha Demo' }),
      row({ id: 'd', status: 'draft', outstanding: '0', contactName: 'Draft Co' }),
    ]
    expect(filterCostsInvoices(invoices, 'approve', 'all', '').map((r) => r.id)).toEqual(['a'])
    expect(filterCostsInvoices(invoices, 'bills', 'open', '').map((r) => r.id)).toEqual(['a', 'b'])
    expect(filterCostsInvoices(invoices, 'bills', 'paid', '').map((r) => r.id)).toEqual(['c'])
    expect(filterCostsInvoices(invoices, 'bills', 'all', 'alpha').map((r) => r.id)).toEqual([
      'a',
      'c',
    ])
    expect(filterCostsInvoices(invoices, 'bills', 'all', '').map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })
})

describe('costsPill', () => {
  it('uses export status colours: paid, late, open, draft, booked, disputed', () => {
    expect(costsPill(row({ id: 'd', status: 'draft' }), '2026-03-01')).toEqual({
      kind: 'draft',
      daysOverdue: null,
    })
    expect(
      costsPill(
        row({ id: 'p', status: 'approved', outstanding: '0', dueDate: '2026-01-01' }),
        '2026-03-01',
      ),
    ).toEqual({ kind: 'paid', daysOverdue: null })
    expect(
      costsPill(
        row({
          id: 'l',
          status: 'approved',
          outstanding: '100',
          dueDate: '2026-01-01',
        }),
        '2026-01-11',
      ),
    ).toEqual({ kind: 'overdue', daysOverdue: 10 })
    expect(
      costsPill(
        row({ id: 'o', status: 'approved', outstanding: '100', dueDate: '2026-04-01' }),
        '2026-03-01',
      ),
    ).toEqual({ kind: 'open', daysOverdue: null })
    expect(
      costsPill(
        row({ id: 'b', status: 'booked', outstanding: '100', dueDate: '2026-04-01' }),
        '2026-03-01',
      ),
    ).toEqual({ kind: 'booked', daysOverdue: null })
    expect(
      costsPill(row({ id: 'x', status: 'disputed', outstanding: '100' }), '2026-03-01'),
    ).toEqual({
      kind: 'disputed',
      daysOverdue: null,
    })
  })
})

describe('approval / actions', () => {
  it('never claims four-eyes on bill approval', () => {
    expect(costsApprovalKind('booked')).toBe('booked')
    expect(costsApprovalKind('approved')).toBe('approved')
  })

  it('gates approve / dispute / add-to-batch on real status', () => {
    expect(showCostsApprove(row({ id: '1', status: 'booked' }))).toBe(true)
    expect(showCostsApprove(row({ id: '2', status: 'approved' }))).toBe(false)
    expect(showCostsDispute(row({ id: '3', status: 'approved' }))).toBe(true)
    expect(
      showCostsAddToBatch(row({ id: '4', status: 'approved', outstanding: '100', payable: true })),
    ).toBe(true)
    expect(
      showCostsAddToBatch(row({ id: '5', status: 'booked', outstanding: '100', payable: false })),
    ).toBe(false)
  })
})

describe('sums / overdue list / approve count', () => {
  it('sums totals and outstanding; counts booked', () => {
    const invoices = [
      row({
        id: 'a',
        status: 'approved',
        total: '100',
        outstanding: '40',
        dueDate: '2026-06-01',
      }),
      row({ id: 'b', status: 'booked', total: '200', outstanding: '200', dueDate: '2020-01-01' }),
    ]
    expect(sumCostsTotals(invoices)).toBe(300n)
    expect(sumCostsOutstanding(invoices)).toBe(240n)
    expect(countAwaitingApproval(invoices)).toBe(1)
    expect(overdueCostsInvoices(invoices, '2026-01-01').map((r) => r.id)).toEqual(['b'])
  })
})
