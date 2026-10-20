import { describe, expect, it } from 'vitest'
import {
  honestySourcesFromExact,
  honestySourcesFromMoneybird,
  importProgressSteps,
  NL_MKB_VAT_RULES,
  suggestVatCode,
  vatCandidatesFor,
  vatOptionsFor,
} from '../../src/lib/import-findings.js'

const LABELS = {
  sales: 'Verkoopfacturen',
  purchases: 'Inkoop en bonnen',
  bookings: (year: number) => `Boekingen ${String(year)}`,
  readCount: (n: number) => `${String(n)} gelezen`,
  zeroRead: '0 gelezen',
  unreadable: 'Niet gelezen',
  doesNotBalance: 'Sluit niet',
  yearRead: 'Gelezen',
}

describe('importProgressSteps', () => {
  it('starts on connect until linked', () => {
    expect(importProgressSteps({ connected: false, hasPreview: false, blockingCount: 0 })).toEqual([
      { id: 'connect', state: 'current' },
      { id: 'read', state: 'todo' },
      { id: 'review', state: 'todo' },
      { id: 'import', state: 'todo' },
    ])
  })

  it('keeps review current while blocking findings remain', () => {
    const steps = importProgressSteps({ connected: true, hasPreview: true, blockingCount: 2 })
    expect(steps.find((step) => step.id === 'review')?.state).toBe('current')
    expect(steps.find((step) => step.id === 'import')?.state).toBe('todo')
  })

  it('advances import when nothing blocks', () => {
    const steps = importProgressSteps({ connected: true, hasPreview: true, blockingCount: 0 })
    expect(steps.find((step) => step.id === 'import')?.state).toBe('current')
    expect(steps.find((step) => step.id === 'review')?.state).toBe('done')
  })
})

describe('honestySourcesFromMoneybird', () => {
  it('shows sales/purchases counts without a Klopt claim', () => {
    const sources = honestySourcesFromMoneybird({
      counts: { salesInvoices: 412, purchaseInvoices: 200, documents: 68 },
      reconciliation: [{ year: 2024, source: 'empty', balanced: null }],
      unreadResource: { label: 'Bijlagen', detail: 'HTTP 403' },
      labels: LABELS,
    })
    expect(sources).toHaveLength(4)
    expect(sources[0]?.honesty).toBeNull()
    expect(sources[0]?.count).toBe('412 gelezen')
    expect(sources[1]?.honesty).toBeNull()
    expect(sources[2]?.honesty).toBe('empty')
    expect(sources[3]?.honesty).toBe('unread')
    expect(sources[3]?.count).toBe('HTTP 403')
  })

  it('never paints an unreadable year as reconciled', () => {
    const sources = honestySourcesFromMoneybird({
      counts: {},
      reconciliation: [{ year: 2025, source: 'unreadable', balanced: true }],
      labels: LABELS,
    })
    const year = sources.find((source) => source.id === 'year-2025')
    expect(year?.honesty).toBe('unread')
    expect(year?.count).toBe('Niet gelezen')
  })

  it('surfaces does-not-balance for a read year that fails', () => {
    const sources = honestySourcesFromMoneybird({
      counts: { salesInvoices: 1 },
      reconciliation: [{ year: 2024, source: 'read', balanced: false }],
      labels: LABELS,
    })
    const year = sources.find((source) => source.id === 'year-2024')
    expect(year?.honesty).toBeNull()
    expect(year?.count).toBe('Sluit niet')
  })

  it('omits sales/purchases when those counts are absent', () => {
    const sources = honestySourcesFromMoneybird({
      counts: {},
      reconciliation: [],
      labels: LABELS,
    })
    expect(sources).toEqual([])
  })
})

describe('honestySourcesFromExact', () => {
  it('returns one cell when honesty is known', () => {
    expect(
      honestySourcesFromExact({
        honesty: 'reconciled',
        label: 'Openstaande posten',
        count: '12 / 4',
      }),
    ).toEqual([
      {
        id: 'exact-control',
        label: 'Openstaande posten',
        count: '12 / 4',
        honesty: 'reconciled',
      },
    ])
  })

  it('returns none when honesty is unknown', () => {
    expect(honestySourcesFromExact({ honesty: null, label: 'x', count: 'y' })).toEqual([])
  })
})

describe('vatOptionsFor / vatCandidatesFor', () => {
  const rules = NL_MKB_VAT_RULES

  it('filters purchase rates to input codes and sales to output via rankVatCodes', () => {
    expect(
      vatOptionsFor({ rules, taxRateType: 'purchase_invoice', percentage: '21' }).map(
        (o) => o.code,
      ),
    ).toEqual(['VH21', 'VH21-PRO'])
    expect(
      vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: '21' }).map((o) => o.code),
    ).toEqual(['H21'])
    expect(
      vatOptionsFor({ rules, taxRateType: 'purchase_invoice', percentage: '9' }).map((o) => o.code),
    ).toEqual(['VL9'])
    expect(
      vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: '9' }).map((o) => o.code),
    ).toEqual(['L9'])
  })

  it('keeps PRIV21 out of the sales picker and VH21-PRO under other', () => {
    const sales = vatCandidatesFor({ rules, taxRateType: 'sales_invoice', percentage: '21' })
    expect(sales.primary.map((row) => row.code)).toEqual(['H21'])
    expect(sales.other.map((row) => row.code)).toEqual([])
    expect(sales.suggestedCode).toBe('H21')

    const purchase = vatCandidatesFor({ rules, taxRateType: 'purchase_invoice', percentage: '21' })
    expect(purchase.primary.map((row) => row.code)).toEqual(['VH21'])
    expect(purchase.other.map((row) => row.code)).toEqual(['VH21-PRO'])
    expect(purchase.suggestedCode).toBe('VH21')
  })

  it('never maps a sales rate onto VH21/VL9', () => {
    const sales = vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: '21' })
    expect(sales.every((option) => option.code === 'H21')).toBe(true)
    expect(sales.some((option) => option.code.startsWith('V') && option.code !== 'VERL')).toBe(
      false,
    )
  })

  it('lists all five 0% sales codes as other and never prefills', () => {
    const zero = vatCandidatesFor({ rules, taxRateType: 'sales_invoice', percentage: '0' })
    expect(zero.primary).toEqual([])
    expect(zero.other.map((o) => o.code)).toEqual(['VERL', 'GEEN', 'NUL', 'ICP', 'ICPD'])
    expect(zero.suggestedCode).toBeNull()
    expect(suggestVatCode({ rules, taxRateType: 'sales_invoice', percentage: '0' })).toBeNull()
  })

  it('covers verlegd, ICP and export as distinct 0% sales matches', () => {
    const zero = vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: '0' })
    expect(zero.find((o) => o.code === 'VERL')?.description).toMatch(/verlegd/i)
    expect(zero.find((o) => o.code === 'ICP')?.description).toMatch(/Intracommunautaire/i)
    expect(zero.find((o) => o.code === 'NUL')?.description).toMatch(/export/i)
  })

  it('returns [] for empty percentage, NaN, unknown direction, or unmatched rate', () => {
    expect(vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: '' })).toEqual([])
    expect(vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: 'abc' })).toEqual([])
    expect(vatOptionsFor({ rules, taxRateType: null, percentage: '21' })).toEqual([])
    expect(vatOptionsFor({ rules, taxRateType: 'other', percentage: '21' })).toEqual([])
    expect(vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: '6' })).toEqual([])
    expect(vatOptionsFor({ rules, taxRateType: 'purchase_invoice', percentage: '0' })).toEqual([])
    expect(suggestVatCode({ rules, taxRateType: 'sales_invoice', percentage: '12' })).toBeNull()
    expect(
      suggestVatCode({ rules, taxRateType: 'purchase_invoice', percentage: '21.5' }),
    ).toBeNull()
  })

  it('prefills only a unique primary', () => {
    expect(suggestVatCode({ rules, taxRateType: 'purchase_invoice', percentage: '21' })).toBe(
      'VH21',
    )
    expect(suggestVatCode({ rules, taxRateType: 'sales_invoice', percentage: '9' })).toBe('L9')
  })
})
