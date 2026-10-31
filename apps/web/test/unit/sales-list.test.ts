import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { reminderEmailCopy } from '@klopt/core/reminder-email'
import {
  countSalesSegments,
  filterSalesInvoices,
  formatSalesSegmentCount,
  invoiceHistoryEvents,
  invoicePill,
  salesSegmentOf,
  sentAsFromDeliveries,
  SALES_LIST_FETCH_LIMIT,
  sumInvoiceTotals,
  type DeliveryRecord,
  type SalesInvoiceRow,
} from '../../src/lib/sales-list.js'

const row = (
  overrides: Partial<SalesInvoiceRow> & Pick<SalesInvoiceRow, 'id' | 'status'>,
): SalesInvoiceRow => ({
  kind: 'invoice',
  number: '2026-0001',
  issueDate: '2026-01-10',
  dueDate: '2026-02-10',
  total: '121000',
  currency: 'EUR',
  contactNumber: 'DEB-1',
  contactName: 'Voorbeeld BV',
  ...overrides,
})

describe('salesSegmentOf / countSalesSegments', () => {
  it('splits drafts, open and overdue; omits cancelled', () => {
    const overdue = new Set(['o1'])
    const invoices = [
      row({ id: 'd1', status: 'draft' }),
      row({ id: 'o1', status: 'issued' }),
      row({ id: 'o2', status: 'issued' }),
      row({ id: 'c1', status: 'cancelled' }),
    ]
    expect(salesSegmentOf(invoices[0]!, overdue)).toBe('draft')
    expect(salesSegmentOf(invoices[1]!, overdue)).toBe('overdue')
    expect(salesSegmentOf(invoices[2]!, overdue)).toBe('open')
    expect(salesSegmentOf(invoices[3]!, overdue)).toBeNull()
    expect(countSalesSegments(invoices, overdue)).toEqual({ draft: 1, open: 1, overdue: 1 })
  })

  it('does not invent a paid segment from client-side guesses', () => {
    // Issued and not in the overdue set → Issued segment (`open` key), even if
    // due date is past. Paid needs outstanding/paidOn from the API.
    const overdue = new Set<string>()
    expect(salesSegmentOf(row({ id: 'x', status: 'issued', dueDate: '2020-01-01' }), overdue)).toBe(
      'open',
    )
  })
})

describe('formatSalesSegmentCount', () => {
  it('shows the exact count for 199 and 200 fetched rows', () => {
    expect(formatSalesSegmentCount(12, 199)).toBe('12')
    expect(formatSalesSegmentCount(0, 199)).toBe('0')
    expect(formatSalesSegmentCount(200, 200)).toBe('200')
    expect(formatSalesSegmentCount(47, 200)).toBe('47')
  })

  it('shows 200+ for every segment when 201 rows come back (list capped)', () => {
    expect(SALES_LIST_FETCH_LIMIT).toBe(201)
    expect(formatSalesSegmentCount(0, 201)).toBe('200+')
    expect(formatSalesSegmentCount(1, 201)).toBe('200+')
    expect(formatSalesSegmentCount(200, 201)).toBe('200+')
    expect(formatSalesSegmentCount(201, 201)).toBe('200+')
  })
})

describe('filterSalesInvoices', () => {
  it('filters by segment and query without hard-coded counts', () => {
    const overdue = new Set(['b'])
    const invoices = [
      row({ id: 'a', status: 'issued', contactName: 'Alpha Demo', number: '2026-0001' }),
      row({ id: 'b', status: 'issued', contactName: 'Beta Demo', number: '2026-0002' }),
      row({ id: 'c', status: 'draft', contactName: 'Alpha Demo', number: null }),
    ]
    expect(filterSalesInvoices(invoices, overdue, 'overdue', '').map((r) => r.id)).toEqual(['b'])
    expect(filterSalesInvoices(invoices, overdue, 'open', 'alpha').map((r) => r.id)).toEqual(['a'])
    expect(filterSalesInvoices(invoices, overdue, 'draft', '2026').map((r) => r.id)).toEqual([])
  })
})

describe('invoicePill', () => {
  it('uses API statuses only: draft, open, overdue, cancelled, credit note', () => {
    const overdue = new Set(['late'])
    expect(invoicePill(row({ id: 'd', status: 'draft' }), overdue, '2026-03-01')).toEqual({
      kind: 'draft',
      daysOverdue: null,
    })
    expect(
      invoicePill(
        row({ id: 'late', status: 'issued', dueDate: '2026-01-01' }),
        overdue,
        '2026-03-01',
      ),
    ).toEqual({
      kind: 'overdue',
      daysOverdue: 59,
    })
    expect(invoicePill(row({ id: 'ok', status: 'issued' }), overdue, '2026-03-01')).toEqual({
      kind: 'open',
      daysOverdue: null,
    })
    expect(invoicePill(row({ id: 'x', status: 'cancelled' }), overdue, '2026-03-01').kind).toBe(
      'cancelled',
    )
    expect(
      invoicePill(row({ id: 'cn', status: 'issued', kind: 'credit_note' }), overdue, '2026-03-01')
        .kind,
    ).toBe('credit_note')
  })
})

describe('sentAsFromDeliveries', () => {
  const delivery = (overrides: Partial<DeliveryRecord>): DeliveryRecord => ({
    id: '1',
    purpose: 'invoice',
    delivered: true,
    channel: 'email',
    transport: 'file',
    sentAt: '2026-01-10T12:00:00.000Z',
    stageLabel: null,
    tone: null,
    failure: null,
    ...overrides,
  })

  it('omits Sent as when there is no delivery record', () => {
    expect(sentAsFromDeliveries([])).toBeNull()
    expect(sentAsFromDeliveries([delivery({ purpose: 'reminder' })])).toBeNull()
  })

  it('reports email with PDF and UBL only when delivered; never Peppol', () => {
    expect(sentAsFromDeliveries([delivery({ delivered: true })])).toEqual({
      kind: 'email_pdf_ubl',
    })
    expect(sentAsFromDeliveries([delivery({ delivered: false })])).toEqual({
      kind: 'not_delivered',
    })
  })
})

describe('invoiceHistoryEvents', () => {
  it('never invents a paid / bank-match step', () => {
    const events = invoiceHistoryEvents({
      issueDate: '2026-01-10',
      dueDate: '2026-02-10',
      status: 'issued',
      overdue: true,
      daysOverdue: 20,
      deliveries: [
        {
          id: '1',
          purpose: 'invoice',
          delivered: true,
          channel: 'email',
          transport: 'file',
          sentAt: '2026-01-10T12:00:00.000Z',
          stageLabel: null,
          tone: null,
          failure: null,
        },
      ],
      nextReminder: { tone: 'final', stageLabel: 'Derde herinnering' },
    })
    expect(events.map((e) => e.kind)).toEqual(['issued', 'sent', 'due_unpaid', 'next_reminder'])
    expect(events.map((e) => e.kind).includes('paid' as never)).toBe(false)
  })
})

describe('sumInvoiceTotals', () => {
  it('sums minor units', () => {
    expect(sumInvoiceTotals([{ total: '100' }, { total: '250' }])).toBe(350n)
  })
})

describe('reminderEmailCopy (Reminders read-only preview)', () => {
  it('stage 3 asks for payment without WIK threats or a 14-day deadline', () => {
    const copy = reminderEmailCopy({
      invoiceNumber: '2026-0037',
      total: '985,93',
      currency: 'EUR',
      dueDate: '2025-02-10',
      stage: 3,
      daysOverdue: 324,
    })
    expect(copy.subject).toBe('Derde herinnering: factuur 2026-0037')
    expect(copy.text).toContain(
      'Wij verzoeken u het openstaande bedrag zo spoedig mogelijk te voldoen.',
    )
    expect(copy.text).toContain('Heeft u vragen over deze factuur, neem dan contact met ons op.')
    expect(copy.subject).not.toMatch(
      /incassokosten|wettelijke\s+rente|incasso|veertien|buitengerechtelijk|6:96|aanmaning/i,
    )
    expect(copy.text).not.toMatch(
      /incassokosten|wettelijke\s+rente|incasso|veertien|buitengerechtelijk|6:96|aanmaning/i,
    )
  })
})

describe('Reminders and Send all use only the server dunning queue', () => {
  it('dunning route loads actions from dunningQueue, not a client invoice list', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../../src/routes/_app/dunning.tsx'),
      'utf8',
    )
    expect(source).toContain("from '~/server/sales'")
    expect(source).toContain('dunningQueue')
    expect(source).toContain('queue.data.actions')
    expect(source).toContain('row.sendable')
    expect(source).not.toContain('listInvoices')
    expect(source).not.toContain('listOverdueInvoices')
  })
})
