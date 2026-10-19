import { describe, expect, it } from 'vitest'
import {
  addDaysIso,
  canAdvanceFromStep,
  computeGuidedTotals,
  defaultOutputTaxCode,
  EURO_NBSP,
  filterCustomers,
  formatDateLongNl,
  formatEuro,
  formatRatePercent,
  isZeroVatRate,
  nextStep,
  prevStep,
  sellerAddressLines,
  sellerIdentifiers,
  taxCodeLabel,
} from '../../src/lib/guided-invoice.js'

const vatLabels = {
  none: 'Geen btw',
  rate: (rate: string) => `${rate}% btw`,
}

const codes = [
  { code: 'VH21', ratePercent: '21.00', rateBasisPoints: 2100, direction: 'output' },
  { code: 'VH9', ratePercent: '9.00', rateBasisPoints: 900, direction: 'output' },
  { code: 'GEEN', ratePercent: '0.00', rateBasisPoints: 0, direction: 'output' },
  { code: 'VI21', ratePercent: '21.00', rateBasisPoints: 2100, direction: 'input' },
]

describe('guided invoice helpers', () => {
  it('formats euro with a non-breaking space after the sign', () => {
    expect(formatEuro(48_723n)).toBe(`${EURO_NBSP}487,23`)
    expect(formatEuro(48_723n).includes('\u00a0')).toBe(true)
    expect(formatEuro(48_723n).includes(' ')).toBe(false)
  })

  it('labels VAT by rate, never by ledger code', () => {
    expect(taxCodeLabel(codes[0], vatLabels)).toBe('21% btw')
    expect(taxCodeLabel(codes[1], vatLabels)).toBe('9% btw')
    expect(taxCodeLabel(codes[2], vatLabels)).toBe('Geen btw')
    expect(isZeroVatRate('0.00')).toBe(true)
    expect(formatRatePercent('21.00')).toBe('21')
  })

  it('defaults to the highest output rate', () => {
    expect(defaultOutputTaxCode(codes)).toBe('VH21')
  })

  it('adds payment-term days on an ISO date', () => {
    expect(addDaysIso('2026-10-18', 14)).toBe('2026-11-01')
    expect(formatDateLongNl('2026-11-01', { includeYear: false })).toBe('1 november')
  })

  it('computes line totals in minor units', () => {
    const totals = computeGuidedTotals(
      [
        {
          description: 'Desembroden',
          quantity: '60',
          unitPrice: '4,20',
          taxCode: 'VH9',
          revenueAccountNumber: '8000',
        },
        {
          description: 'Appeltaarten',
          quantity: '6',
          unitPrice: '32,50',
          taxCode: 'VH9',
          revenueAccountNumber: '8000',
        },
        {
          description: '',
          quantity: '1',
          unitPrice: '100,00',
          taxCode: 'VH21',
          revenueAccountNumber: '8000',
        },
      ],
      codes,
      vatLabels,
    )
    expect(totals.net).toBe(44_700n)
    expect(totals.tax).toBe(4_023n)
    expect(totals.total).toBe(48_723n)
    expect(totals.taxByLabel).toEqual([{ label: '9% btw', amount: 4_023n }])
  })

  it('filters customers by name, number or email', () => {
    const rows = [
      { name: 'Hotel Zeezicht B.V.', number: 'DEB-1', email: 'a@hotel.nl' },
      { name: 'Lunchroom Het Hoekje', number: 'DEB-2', email: null },
    ]
    expect(filterCustomers(rows, 'zee')).toHaveLength(1)
    expect(filterCustomers(rows, 'DEB-2')).toHaveLength(1)
    expect(filterCustomers(rows, 'hotel.nl')).toHaveLength(1)
  })

  it('gates step advancement', () => {
    expect(canAdvanceFromStep(1, { contactNumber: '', lines: [], sendMethod: 'email' })).toBe(false)
    expect(canAdvanceFromStep(1, { contactNumber: 'DEB-1', lines: [], sendMethod: 'email' })).toBe(
      true,
    )
    expect(
      canAdvanceFromStep(2, {
        contactNumber: 'DEB-1',
        lines: [
          {
            description: 'x',
            quantity: '1',
            unitPrice: '10,00',
            taxCode: 'VH21',
            revenueAccountNumber: '8000',
          },
        ],
        sendMethod: 'email',
      }),
    ).toBe(true)
    expect(nextStep(3)).toBe(4)
    expect(prevStep(1)).toBe(null)
  })

  it('omits blank seller address lines and never invents identifiers', () => {
    expect(
      sellerAddressLines({
        street: 'Lange Delft',
        houseNumber: '41',
        postalCode: null,
        city: 'Middelburg',
      }),
    ).toEqual(['Lange Delft 41', 'Middelburg'])
    expect(sellerIdentifiers({ kvkNumber: null, vatNumber: null })).toBe('')
    expect(sellerIdentifiers({ kvkNumber: '61234567', vatNumber: 'NL861234567B01' })).toBe(
      'KvK 61234567 · NL861234567B01',
    )
  })
})
