import { describe, expect, it } from 'vitest'
import {
  addDaysIso,
  canAdvanceFromStep,
  computeGuidedTotals,
  defaultOutputTaxCode,
  EURO_NBSP,
  filterCustomers,
  formatDateLongNl,
  formatDateShort,
  formatEuro,
  formatRatePercent,
  isZeroVatRate,
  nextStep,
  parseDateShort,
  prevStep,
  salesPickerTaxCodes,
  sellerAddressLines,
  sellerIdentifiers,
  taxCodeLabel,
  ZERO_RATE_SALES_CODES,
  type VatLabelBag,
} from '../../src/lib/guided-invoice.js'

const vatLabels: VatLabelBag = {
  rate: (rate: string) => `${rate}% btw`,
  byCode: {
    VERL: 'Btw verlegd',
    GEEN: 'Vrijgesteld van btw',
    NUL: '0% export buiten de EU',
    ICP: '0% levering in de EU (goederen)',
    ICPD: '0% dienst in de EU',
  },
}

const codes = [
  { code: 'H21', ratePercent: '21.00', rateBasisPoints: 2100, direction: 'output' },
  { code: 'L9', ratePercent: '9.00', rateBasisPoints: 900, direction: 'output' },
  { code: 'GEEN', ratePercent: '0.00', rateBasisPoints: 0, direction: 'output' },
  { code: 'VERL', ratePercent: '0.00', rateBasisPoints: 0, direction: 'output' },
  { code: 'NUL', ratePercent: '0.00', rateBasisPoints: 0, direction: 'output' },
  { code: 'ICP', ratePercent: '0.00', rateBasisPoints: 0, direction: 'output' },
  { code: 'ICPD', ratePercent: '0.00', rateBasisPoints: 0, direction: 'output' },
  { code: 'PRIV21', ratePercent: '21.00', rateBasisPoints: 2100, direction: 'output' },
  { code: 'VH21', ratePercent: '21.00', rateBasisPoints: 2100, direction: 'input' },
]

describe('guided invoice helpers', () => {
  it('formats euro with a non-breaking space after the sign', () => {
    expect(formatEuro(48_723n)).toBe(`${EURO_NBSP}487,23`)
    expect(formatEuro(48_723n).includes('\u00a0')).toBe(true)
    expect(formatEuro(48_723n).includes(' ')).toBe(false)
  })

  it('labels VAT by rate or distinct zero-rate copy, never by ledger code alone', () => {
    expect(taxCodeLabel(codes[0], vatLabels)).toBe('21% btw')
    expect(taxCodeLabel(codes[1], vatLabels)).toBe('9% btw')
    expect(taxCodeLabel(codes[2], vatLabels)).toBe('Vrijgesteld van btw')
    expect(taxCodeLabel(codes[3], vatLabels)).toBe('Btw verlegd')
    expect(taxCodeLabel(codes[4], vatLabels)).toBe('0% export buiten de EU')
    expect(taxCodeLabel(codes[5], vatLabels)).toBe('0% levering in de EU (goederen)')
    expect(taxCodeLabel(codes[6], vatLabels)).toBe('0% dienst in de EU')
    const zeroLabels = ZERO_RATE_SALES_CODES.map((code) =>
      taxCodeLabel(
        codes.find((row) => row.code === code),
        vatLabels,
      ),
    )
    expect(new Set(zeroLabels).size).toBe(ZERO_RATE_SALES_CODES.length)
    expect(isZeroVatRate('0.00')).toBe(true)
    expect(formatRatePercent('21.00')).toBe('21')
  })

  it('excludes PRIV21 from the sales picker and defaults to H21', () => {
    const picker = salesPickerTaxCodes(codes)
    expect(picker.map((row) => row.code)).not.toContain('PRIV21')
    expect(picker.map((row) => row.code)).not.toContain('VH21')
    expect(defaultOutputTaxCode(codes)).toBe('H21')
    expect(defaultOutputTaxCode(codes.filter((row) => row.code !== 'H21'))).toBe('L9')
    expect(
      defaultOutputTaxCode(
        codes.filter((row) => row.rateBasisPoints === 0 || row.code === 'PRIV21'),
      ),
    ).toBe('')
  })

  it('parses and formats short Dutch dates', () => {
    expect(formatDateShort('2026-11-01')).toBe('01-11-2026')
    expect(parseDateShort('01-11-2026')).toBe('2026-11-01')
    expect(parseDateShort('1-11-2026')).toBe('2026-11-01')
    expect(parseDateShort('32-11-2026')).toBe(null)
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
          taxCode: 'L9',
          revenueAccountNumber: '8000',
        },
        {
          description: 'Appeltaarten',
          quantity: '6',
          unitPrice: '32,50',
          taxCode: 'L9',
          revenueAccountNumber: '8000',
        },
        {
          description: '',
          quantity: '1',
          unitPrice: '100,00',
          taxCode: 'H21',
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

  it('filters customers by name, number, email or city', () => {
    const rows = [
      { name: 'Hotel Zeezicht B.V.', number: 'DEB-1', email: 'a@hotel.nl', city: 'Vlissingen' },
      { name: 'Lunchroom Het Hoekje', number: 'DEB-2', email: null, city: 'Middelburg' },
    ]
    expect(filterCustomers(rows, 'zee')).toHaveLength(1)
    expect(filterCustomers(rows, 'DEB-2')).toHaveLength(1)
    expect(filterCustomers(rows, 'hotel.nl')).toHaveLength(1)
    expect(filterCustomers(rows, 'middel')).toHaveLength(1)
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
            taxCode: 'H21',
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
