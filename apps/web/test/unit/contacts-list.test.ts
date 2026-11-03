import { describe, expect, it } from 'vitest'
import {
  aggregateContacts,
  contactInitials,
  contactRoleLabel,
  countContactRoles,
  filterContacts,
  formatContactInvoiceDue,
  missingEInvoicingDetails,
  parseContactsRoleFilter,
  salesDocStatus,
  supplierOpenSummary,
  type ContactListRow,
  type ContactSalesDoc,
} from '../../src/lib/contacts-list.js'

const rows: readonly ContactListRow[] = [
  {
    id: '1',
    number: 'C001',
    name: 'Atlas Voorbeeld Handel',
    isCustomer: true,
    isSupplier: false,
    email: 'facturen@example.nl',
    vatNumber: 'NL000001001B99',
    countryCode: 'NL',
    paymentTermsDays: 30,
    isBlocked: false,
  },
  {
    id: '2',
    number: 'S001',
    name: 'Kantoorpapier Proef',
    isCustomer: false,
    isSupplier: true,
    email: null,
    vatNumber: null,
    countryCode: 'NL',
    paymentTermsDays: 14,
    isBlocked: false,
  },
  {
    id: '3',
    number: 'B001',
    name: 'Beide Fictief',
    isCustomer: true,
    isSupplier: true,
    email: 'beide@example.nl',
    vatNumber: null,
    countryCode: 'NL',
    paymentTermsDays: 30,
    isBlocked: false,
  },
]

function salesInvoice(
  patch: Partial<ContactSalesDoc> & Pick<ContactSalesDoc, 'id' | 'contactNumber'>,
): ContactSalesDoc {
  return {
    number: '2026-0001',
    total: '121000',
    outstanding: '121000',
    status: 'issued',
    kind: 'invoice',
    dueDate: '2026-12-01',
    ...patch,
  }
}

describe('contactInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(contactInitials('Atlas Voorbeeld Handel')).toBe('AV')
    expect(contactInitials('Kade & Co')).toBe('KC')
    expect(contactInitials('Zandbank')).toBe('Z')
  })
})

describe('parseContactsRoleFilter', () => {
  it('defaults unknown values to all', () => {
    expect(parseContactsRoleFilter('nope')).toBe('all')
    expect(parseContactsRoleFilter('customers')).toBe('customers')
    expect(parseContactsRoleFilter('suppliers')).toBe('suppliers')
  })
})

describe('countContactRoles / filterContacts', () => {
  it('counts customers and suppliers independently (both counts in each)', () => {
    expect(countContactRoles(rows)).toEqual({ all: 3, customers: 2, suppliers: 2 })
  })

  it('filters by role and by name / VAT / number', () => {
    expect(filterContacts(rows, 'customers', '').map((row) => row.number)).toEqual(['C001', 'B001'])
    expect(filterContacts(rows, 'suppliers', '').map((row) => row.number)).toEqual(['S001', 'B001'])
    expect(filterContacts(rows, 'all', 'voorbeeld').map((row) => row.number)).toEqual(['C001'])
    expect(filterContacts(rows, 'all', 'nl000001001').map((row) => row.number)).toEqual(['C001'])
    expect(filterContacts(rows, 'all', 's001').map((row) => row.number)).toEqual(['S001'])
  })
})

describe('aggregateContacts (#195 item 1 — customer open)', () => {
  const purchases = [
    {
      id: 'bill-1',
      contactNumber: 'S001',
      total: '4000',
      outstanding: '1500',
      dueDate: '2025-01-01',
      status: 'approved',
    },
  ] as const

  it('case 1: issued, not yet due, unpaid → open = full total (list + card aggregate)', () => {
    const map = aggregateContacts(
      rows,
      [
        salesInvoice({
          id: 'inv-future',
          contactNumber: 'C001',
          total: '25000',
          outstanding: '25000',
          dueDate: '2026-12-15',
        }),
      ],
      [...purchases],
      [],
    )
    expect(map.get('C001')?.openMinor).toBe(25000n)
    expect(map.get('C001')?.lateDays).toBeNull()
  })

  it('case 2: partly paid → open = total minus allocated amount', () => {
    const map = aggregateContacts(
      rows,
      [
        salesInvoice({
          id: 'inv-part',
          contactNumber: 'C001',
          total: '121000',
          outstanding: '81000',
        }),
      ],
      [...purchases],
      [],
    )
    expect(map.get('C001')?.openMinor).toBe(81000n)
  })

  it('case 3: credit note against invoice → net outstanding, not double-counted', () => {
    const map = aggregateContacts(
      rows,
      [
        salesInvoice({
          id: 'inv-net',
          contactNumber: 'C001',
          total: '121000',
          outstanding: '100000',
        }),
        salesInvoice({
          id: 'cn-1',
          contactNumber: 'C001',
          total: '21000',
          outstanding: '0',
          kind: 'credit_note',
        }),
      ],
      [...purchases],
      [],
    )
    expect(map.get('C001')?.openMinor).toBe(100000n)
  })

  it('case 4: fully paid → € 0,00 and no overdue marker', () => {
    const map = aggregateContacts(
      rows,
      [
        salesInvoice({
          id: 'inv-paid',
          contactNumber: 'C001',
          total: '121000',
          outstanding: '0',
        }),
      ],
      [...purchases],
      [],
    )
    expect(map.get('C001')?.openMinor).toBe(0n)
    expect(map.get('C001')?.lateDays).toBeNull()
  })

  it('overdue invoice: open counted once; lateDays from overdue report only', () => {
    const map = aggregateContacts(
      rows,
      [
        salesInvoice({
          id: 'inv-late',
          contactNumber: 'C001',
          total: '50000',
          outstanding: '50000',
          dueDate: '2026-01-01',
        }),
        salesInvoice({
          id: 'inv-future',
          contactNumber: 'C001',
          total: '25000',
          outstanding: '25000',
          dueDate: '2026-12-01',
        }),
      ],
      [...purchases],
      [{ id: 'inv-late', contactName: 'Atlas Voorbeeld Handel', total: '50000', daysOverdue: 12 }],
    )
    expect(map.get('C001')).toEqual({
      volumeMinor: 75000n,
      documentCount: 2,
      openMinor: 75000n,
      lateDays: 12,
    })
  })

  it('sums supplier open from purchase outstanding', () => {
    const map = aggregateContacts(rows, [], [...purchases], [])
    expect(map.get('S001')?.openMinor).toBe(1500n)
  })
})

describe('salesDocStatus / formatContactInvoiceDue', () => {
  it('pills only draft/cancelled; issued uses open text from outstanding', () => {
    expect(salesDocStatus({ status: 'draft', kind: 'invoice', outstanding: '0' })).toEqual({
      pill: 'draft',
      openMinor: null,
    })
    expect(salesDocStatus({ status: 'cancelled', kind: 'invoice', outstanding: '0' })).toEqual({
      pill: 'cancelled',
      openMinor: null,
    })
    expect(
      salesDocStatus({ status: 'issued', kind: 'invoice', outstanding: '10000' }),
    ).toEqual({
      pill: null,
      openMinor: 10000n,
    })
    expect(
      salesDocStatus({ status: 'issued', kind: 'invoice', outstanding: '0' }),
    ).toEqual({
      pill: null,
      openMinor: null,
    })
  })

  it('formats due hint dates for NL and EN', () => {
    expect(formatContactInvoiceDue('2026-03-15', 'nl-NL')).toMatch(/15/)
    expect(formatContactInvoiceDue('2026-03-15', 'en-GB')).toMatch(/15/)
  })
})

describe('contactRoleLabel / missingEInvoicingDetails', () => {
  it('labels roles without inventing a third state', () => {
    expect(
      contactRoleLabel(rows[0]!, {
        customer: 'Customer',
        supplier: 'Supplier',
        both: 'Customer · Supplier',
      }),
    ).toBe('Customer')
    expect(
      contactRoleLabel(rows[2]!, {
        customer: 'Customer',
        supplier: 'Supplier',
        both: 'Customer · Supplier',
      }),
    ).toBe('Customer · Supplier')
  })

  it('flags missing address, email, or supplier IBAN', () => {
    expect(
      missingEInvoicingDetails({
        email: 'a@example.nl',
        iban: null,
        isSupplier: false,
        address: { street: 'Demo', postalCode: '1000 AA', city: 'Amsterdam' },
      }),
    ).toBe(false)
    expect(
      missingEInvoicingDetails({
        email: null,
        iban: null,
        isSupplier: false,
        address: { street: 'Demo', postalCode: '1000 AA', city: 'Amsterdam' },
      }),
    ).toBe(true)
    expect(
      missingEInvoicingDetails({
        email: 'a@example.nl',
        iban: null,
        isSupplier: true,
        address: { street: 'Demo', postalCode: '1000 AA', city: 'Amsterdam' },
      }),
    ).toBe(true)
  })
})

describe('supplierOpenSummary (#163 Legal)', () => {
  const asOf = '2026-06-15'
  const bills = [
    {
      id: 'b1',
      contactNumber: 'S001',
      total: '121000',
      outstanding: '121000',
      dueDate: '2026-03-01',
      status: 'approved',
    },
    {
      id: 'b2',
      contactNumber: 'S001',
      total: '50000',
      outstanding: '50000',
      dueDate: '2026-12-01',
      status: 'approved',
    },
    {
      id: 'b3',
      contactNumber: 'S001',
      total: '10000',
      outstanding: '0',
      dueDate: '2026-01-01',
      status: 'approved',
    },
    {
      id: 'b4',
      contactNumber: 'S001',
      total: '20000',
      outstanding: '20000',
      dueDate: '2026-06-15',
      status: 'approved',
    },
  ] as const

  it('counts open amount from purchase outstanding only', () => {
    expect(supplierOpenSummary(bills, asOf)).toEqual({
      openCount: 3,
      openMinor: 191000n,
      overdueCount: 1,
    })
  })

  it('marks overdue only when dueDate < asOf (daysOverdue > 0)', () => {
    expect(supplierOpenSummary([bills[0]], asOf).overdueCount).toBe(1)
    expect(supplierOpenSummary([bills[1]], asOf).overdueCount).toBe(0)
    expect(supplierOpenSummary([bills[3]], asOf).overdueCount).toBe(0)
  })

  it('reports zero open without inventing a paid claim', () => {
    expect(supplierOpenSummary([bills[2]], asOf)).toEqual({
      openCount: 0,
      openMinor: 0n,
      overdueCount: 0,
    })
    expect(supplierOpenSummary([], asOf)).toEqual({
      openCount: 0,
      openMinor: 0n,
      overdueCount: 0,
    })
  })
})
