import { describe, expect, it } from 'vitest'
import {
  aggregateContacts,
  contactInitials,
  contactRoleLabel,
  countContactRoles,
  filterContacts,
  missingEInvoicingDetails,
  parseContactsRoleFilter,
  salesDocStatus,
  supplierOpenSummary,
  type ContactListRow,
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

describe('aggregateContacts', () => {
  it('sums volume and documents; open from overdue (by name) and purchases', () => {
    const map = aggregateContacts(
      rows,
      [
        {
          id: 'inv-1',
          number: '2025-0001',
          total: '10000',
          contactNumber: 'C001',
          status: 'issued',
          kind: 'invoice',
          dueDate: '2025-01-01',
        },
        {
          id: 'inv-2',
          number: '2025-0002',
          total: '2500',
          contactNumber: 'C001',
          status: 'issued',
          kind: 'invoice',
          dueDate: '2025-02-01',
        },
      ],
      [
        {
          id: 'bill-1',
          contactNumber: 'S001',
          total: '4000',
          outstanding: '1500',
          dueDate: '2025-01-01',
          status: 'approved',
        },
      ],
      [{ id: 'inv-1', contactName: 'Atlas Voorbeeld Handel', total: '10000', daysOverdue: 12 }],
    )

    expect(map.get('C001')).toEqual({
      volumeMinor: 12500n,
      documentCount: 2,
      openMinor: 10000n,
      lateDays: 12,
    })
    expect(map.get('S001')).toEqual({
      volumeMinor: 4000n,
      documentCount: 1,
      openMinor: 1500n,
      lateDays: null,
    })
  })
})

describe('contactRoleLabel / missingEInvoicingDetails / salesDocStatus', () => {
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

  it('pills only draft/cancelled from invoice_status; issued uses open text, never late/paid', () => {
    const openById = new Map<string, bigint>([['inv-1', 10000n]])
    expect(salesDocStatus({ id: 'd1', status: 'draft' }, openById)).toEqual({
      pill: 'draft',
      openMinor: null,
    })
    expect(salesDocStatus({ id: 'c1', status: 'cancelled' }, openById)).toEqual({
      pill: 'cancelled',
      openMinor: null,
    })
    expect(salesDocStatus({ id: 'inv-1', status: 'issued' }, openById)).toEqual({
      pill: null,
      openMinor: 10000n,
    })
    expect(salesDocStatus({ id: 'inv-2', status: 'issued' }, openById)).toEqual({
      pill: null,
      openMinor: null,
    })
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
      dueDate: '2026-03-01', // past → overdue
      status: 'approved',
    },
    {
      id: 'b2',
      contactNumber: 'S001',
      total: '50000',
      outstanding: '50000',
      dueDate: '2026-12-01', // future → open, not overdue
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
      dueDate: '2026-06-15', // due today → not overdue (#118 exclusive)
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
