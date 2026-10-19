import { describe, expect, it } from 'vitest'
import {
  honestySourcesFromExact,
  honestySourcesFromMoneybird,
  importProgressSteps,
  suggestVatCode,
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

describe('vatOptionsFor', () => {
  it('filters purchase rates to input codes', () => {
    expect(
      vatOptionsFor({ taxRateType: 'purchase_invoice', percentage: '21' }).map((o) => o.code),
    ).toEqual(['VH21'])
    expect(
      vatOptionsFor({ taxRateType: 'sales_invoice', percentage: '21' }).map((o) => o.code),
    ).toEqual(['H21'])
  })

  it('does not fall back to 21% for unsupported rates', () => {
    expect(vatOptionsFor({ taxRateType: 'purchase_invoice', percentage: '6' })).toEqual([])
    expect(suggestVatCode({ taxRateType: 'sales_invoice', percentage: '12' })).toBeNull()
  })
})
