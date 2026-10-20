import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  honestySourcesFromExact,
  honestySourcesFromMoneybird,
  importProgressSteps,
  importVatRulesFromListTaxCodes,
  NL_MKB_VAT_RULES,
  suggestVatCode,
  vatCandidatesFor,
  vatOptionsFor,
  type ListTaxCodeRow,
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

const CHART_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'reference-data',
  'charts',
  'nl-mkb.json',
)

const chartTaxCodes = (
  JSON.parse(readFileSync(CHART_PATH, 'utf8')) as { taxCodes: readonly ListTaxCodeRow[] }
).taxCodes

/** Full chart shaped like `listTaxCodes` (incl. deductionCode). */
const chartRules = importVatRulesFromListTaxCodes(chartTaxCodes)

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

describe('vatCandidatesFor on full nl-mkb.json (listTaxCodes shape)', () => {
  it('keeps NL_MKB_VAT_RULES in sync with the chart file', () => {
    expect(NL_MKB_VAT_RULES.map((row) => row.code).sort()).toEqual(
      chartRules.map((row) => row.code).sort(),
    )
    expect(NL_MKB_VAT_RULES.length).toBe(chartTaxCodes.length)
  })

  it('preselects VH21 for 21% purchase; halves stay out of the picker', () => {
    const purchase = vatCandidatesFor({
      rules: chartRules,
      taxRateType: 'purchase_invoice',
      percentage: '21',
    })
    expect(purchase.primary.map((row) => row.code)).toEqual(['VH21'])
    expect(purchase.suggestedCode).toBe('VH21')
    expect(purchase.other.map((row) => row.code).sort()).toEqual(
      ['ICV21', 'INV23', 'VERL-ONTV'].sort(),
    )
    expect(purchase.other.map((row) => row.code)).not.toContain('VERL-VOOR')
    expect(purchase.other.map((row) => row.code)).not.toContain('ICV21-VOOR')
    expect(purchase.other.map((row) => row.code)).not.toContain('INV23-VOOR')
  })

  it('preselects VL9 / H21 / L9 for the plain rates', () => {
    const ninePurchase = vatCandidatesFor({
      rules: chartRules,
      taxRateType: 'purchase_invoice',
      percentage: '9',
    })
    expect(ninePurchase.primary.map((row) => row.code)).toEqual(['VL9'])
    expect(ninePurchase.other.map((row) => row.code).sort()).toEqual(
      ['ICV9', 'INV9', 'VERL9-ONTV'].sort(),
    )
    expect(
      vatCandidatesFor({
        rules: chartRules,
        taxRateType: 'sales_invoice',
        percentage: '21',
      }),
    ).toMatchObject({ primary: [{ code: 'H21' }], other: [], suggestedCode: 'H21' })
    expect(
      vatCandidatesFor({
        rules: chartRules,
        taxRateType: 'sales_invoice',
        percentage: '9',
      }).suggestedCode,
    ).toBe('L9')
  })

  it('lists five 0% sales codes as other with no preselect; 0% purchase offers VGEEN', () => {
    const zeroSales = vatCandidatesFor({
      rules: chartRules,
      taxRateType: 'sales_invoice',
      percentage: '0',
    })
    expect(zeroSales.primary).toEqual([])
    expect(zeroSales.other.map((row) => row.code)).toEqual(['VERL', 'GEEN', 'NUL', 'ICP', 'ICPD'])
    expect(zeroSales.suggestedCode).toBeNull()
    expect(
      suggestVatCode({ rules: chartRules, taxRateType: 'sales_invoice', percentage: '0' }),
    ).toBeNull()
    const zeroPurchase = vatCandidatesFor({
      rules: chartRules,
      taxRateType: 'purchase_invoice',
      percentage: '0',
    })
    expect(zeroPurchase.primary).toEqual([])
    expect(zeroPurchase.other.map((row) => row.code)).toEqual(['VGEEN'])
    expect(zeroPurchase.suggestedCode).toBeNull()
  })

  it('offers L6/H19 for historical sales and VL6/VH19 for historical purchase rates', () => {
    expect(
      vatCandidatesFor({
        rules: chartRules,
        taxRateType: 'sales_invoice',
        percentage: '6',
      }),
    ).toMatchObject({ primary: [{ code: 'L6' }], suggestedCode: 'L6' })
    expect(
      vatCandidatesFor({
        rules: chartRules,
        taxRateType: 'sales_invoice',
        percentage: '19',
      }),
    ).toMatchObject({ primary: [{ code: 'H19' }], suggestedCode: 'H19' })
    expect(
      vatCandidatesFor({
        rules: chartRules,
        taxRateType: 'purchase_invoice',
        percentage: '6',
      }),
    ).toMatchObject({ primary: [{ code: 'VL6' }], suggestedCode: 'VL6' })
    expect(
      vatCandidatesFor({
        rules: chartRules,
        taxRateType: 'purchase_invoice',
        percentage: '19',
      }),
    ).toMatchObject({ primary: [{ code: 'VH19' }], suggestedCode: 'VH19' })
  })

  it('does not preselect across directions for unknown 6% / 19% rates', () => {
    expect(
      vatCandidatesFor({
        rules: chartRules,
        taxRateType: null,
        percentage: '6',
      }),
    ).toEqual({ primary: [], other: [], suggestedCode: null })
    expect(
      vatCandidatesFor({
        rules: chartRules,
        taxRateType: 'other',
        percentage: '19',
      }),
    ).toEqual({ primary: [], other: [], suggestedCode: null })
  })

  it('keeps PRIV21 out of the sales picker', () => {
    const sales = vatCandidatesFor({
      rules: chartRules,
      taxRateType: 'sales_invoice',
      percentage: '21',
    })
    expect(sales.other.map((row) => row.code)).not.toContain('PRIV21')
    expect(
      vatOptionsFor({ rules: chartRules, taxRateType: 'sales_invoice', percentage: '21' }).map(
        (row) => row.code,
      ),
    ).toEqual(['H21'])
  })
})

describe('vatOptionsFor / vatCandidatesFor (NL_MKB_VAT_RULES)', () => {
  const rules = NL_MKB_VAT_RULES

  it('filters purchase rates to input codes and sales to output via rankVatCodes', () => {
    expect(
      vatOptionsFor({ rules, taxRateType: 'purchase_invoice', percentage: '21' }).map(
        (o) => o.code,
      ),
    ).toEqual(['VH21', 'VERL-ONTV', 'ICV21', 'INV23'])
    expect(
      vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: '21' }).map((o) => o.code),
    ).toEqual(['H21'])
    expect(
      vatOptionsFor({ rules, taxRateType: 'purchase_invoice', percentage: '9' }).map((o) => o.code),
    ).toEqual(['VL9', 'VERL9-ONTV', 'ICV9', 'INV9'])
    expect(
      vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: '9' }).map((o) => o.code),
    ).toEqual(['L9'])
    expect(
      vatOptionsFor({ rules, taxRateType: 'purchase_invoice', percentage: '0' }).map((o) => o.code),
    ).toEqual(['VGEEN'])
    expect(
      vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: '6' }).map((o) => o.code),
    ).toEqual(['L6'])
    expect(
      vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: '19' }).map((o) => o.code),
    ).toEqual(['H19'])
    expect(
      vatOptionsFor({ rules, taxRateType: 'purchase_invoice', percentage: '6' }).map((o) => o.code),
    ).toEqual(['VL6'])
    expect(
      vatOptionsFor({ rules, taxRateType: 'purchase_invoice', percentage: '19' }).map(
        (o) => o.code,
      ),
    ).toEqual(['VH19'])
  })

  it('never maps a sales rate onto VH21/VL9', () => {
    const sales = vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: '21' })
    expect(sales.every((option) => option.code === 'H21')).toBe(true)
    expect(sales.some((option) => option.code.startsWith('V') && option.code !== 'VERL')).toBe(
      false,
    )
  })

  it('returns [] for empty percentage, NaN, unknown direction, or unmatched rate', () => {
    expect(vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: '' })).toEqual([])
    expect(vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: 'abc' })).toEqual([])
    expect(vatOptionsFor({ rules, taxRateType: null, percentage: '21' })).toEqual([])
    expect(vatOptionsFor({ rules, taxRateType: 'other', percentage: '21' })).toEqual([])
    expect(vatOptionsFor({ rules, taxRateType: 'purchase_invoice', percentage: '12' })).toEqual([])
    expect(vatOptionsFor({ rules, taxRateType: 'sales_invoice', percentage: '12' })).toEqual([])
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
