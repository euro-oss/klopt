import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findIncompatibleTaxMappings,
  mayClaimReconciled,
  planMoneybirdImport,
  parseAdministration,
  parseTaxRate,
  type ExistingTaxRule,
  type MoneybirdImportOptions,
} from '../../src/index.js'
import { loadChart } from '../../src/setup/chart.js'
import { snapshot, snapshotV2 } from './fixture.js'

const NL_MKB = loadChart(
  JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        '..',
        'reference-data',
        'charts',
        'nl-mkb.json',
      ),
      'utf8',
    ),
  ),
)

const nlMkbTaxRules: readonly ExistingTaxRule[] = NL_MKB.taxCodes.map((code) => ({
  code: code.code,
  rateBasisPoints: code.rateBasisPoints,
  direction: code.direction,
  scope: code.scope,
  reverseCharge: code.reverseCharge,
  deductionCode: code.deductionCode,
  deductibility: code.deductibility,
}))

const options = (overrides: Partial<MoneybirdImportOptions> = {}): MoneybirdImportOptions => ({
  entityId: 'entity-1',
  currency: 'EUR',
  existingAccountNumbers: [],
  existingContactNumbers: [],
  existingTaxRules: [
    { code: 'H21', rateBasisPoints: 2100, direction: 'output' },
    { code: 'VH21', rateBasisPoints: 2100, direction: 'input' },
  ],
  confirmedAccountMappings: {},
  confirmedTaxMappings: {},
  existingExternalIds: [],
  lockedYears: [],
  entityFiscalYearStartMonth: 1,
  ...overrides,
})

describe('the chart of accounts', () => {
  it('maps Moneybird types onto ours', () => {
    const plan = planMoneybirdImport(snapshot(), options())
    const byNumber = new Map(plan.accounts.map((account) => [account.number, account]))
    expect(byNumber.get('1100')).toMatchObject({ type: 'asset', normalBalance: 'debit' })
    expect(byNumber.get('1600')).toMatchObject({ type: 'liability', normalBalance: 'credit' })
    expect(byNumber.get('8000')).toMatchObject({ type: 'revenue', normalBalance: 'credit' })
    expect(byNumber.get('4000')).toMatchObject({ type: 'expense', normalBalance: 'debit' })
    expect(byNumber.get('0500')).toMatchObject({ type: 'equity', normalBalance: 'credit' })
  })

  it('says which accounts already exist here', () => {
    const plan = planMoneybirdImport(snapshot(), options({ existingAccountNumbers: ['1300'] }))
    expect(
      plan.accounts.filter((account) => account.exists).map((account) => account.number),
    ).toEqual(['1300'])
  })
})

describe('booked history', () => {
  it('plans sales, purchases, bank mutations and the general journal', () => {
    const plan = planMoneybirdImport(snapshot(), options())
    expect(plan.entries.map((entry) => entry.kind).sort()).toEqual([
      'bank_mutation',
      'journal',
      'purchase_invoice',
      'sales_invoice',
    ])
  })

  it('skips a draft rather than posting it, and says so', () => {
    const base = snapshot()
    const draft = { ...base.salesInvoices[0]!, state: 'draft' }
    const plan = planMoneybirdImport(snapshot({ salesInvoices: [draft] }), options())
    expect(plan.entries.some((entry) => entry.kind === 'sales_invoice')).toBe(false)
    expect(plan.warnings.map((warning) => warning.code)).toContain('draft_skipped')
  })

  it('refuses a foreign-currency administration rather than converting it', () => {
    const plan = planMoneybirdImport(
      snapshot({ administration: { ...snapshot().administration, currency: 'USD' } }),
      options(),
    )
    expect(plan.problems.map((problem) => problem.code)).toContain('unknown_currency')
  })

  it('lists what is not imported rather than dropping it', () => {
    const plan = planMoneybirdImport(snapshot(), options())
    expect(plan.notImported).toContain('recurring_sales_invoices')
    expect(plan.notImported).toContain('oauth')
    expect(plan.notImported).toContain('generic_saas_importer_framework')
  })

  it('does not treat an already imported invoice as new work', () => {
    const plan = planMoneybirdImport(
      snapshot(),
      options({ existingExternalIds: ['sales_invoice:301'] }),
    )
    expect(plan.entries.find((entry) => entry.externalId === 'sales_invoice:301')?.exists).toBe(
      true,
    )
  })

  it('plans only the new invoice and mutation after v1 is imported', () => {
    const first = planMoneybirdImport(snapshot(), options())
    const known = first.entries.map((entry) => entry.externalId)
    const second = planMoneybirdImport(snapshotV2(), options({ existingExternalIds: known }))
    expect(
      second.entries
        .filter((entry) => !entry.exists)
        .map((entry) => entry.externalId)
        .sort(),
    ).toEqual(['bank_mutation:602', 'sales_invoice:302'])
  })

  it('refuses a Moneybird year that does not start with this entity', () => {
    const plan = planMoneybirdImport(
      snapshot({
        administration: parseAdministration({
          id: 123456,
          name: 'Voorbeeld BV',
          language: 'nl',
          currency: 'EUR',
          country: 'NL',
          time_zone: 'Europe/Amsterdam',
          period_start_date: '2026-04-01',
        }),
      }),
      options(),
    )
    const mismatch = plan.problems.find((problem) => problem.code === 'fiscal_year_start_mismatch')
    expect(mismatch).toBeDefined()
    expect(mismatch?.messageKey).toBe('moneybird.fiscal_year_start_mismatch')
    expect(mismatch?.message).toContain('month 4')
    expect(mismatch?.message).toContain('month 1')
    expect(mismatch?.detail).toEqual({ moneybirdMonth: '4', entityMonth: '1' })
  })

  it('warns when Moneybird does not say which month the year starts', () => {
    const plan = planMoneybirdImport(
      snapshot({
        administration: parseAdministration({
          id: 123456,
          name: 'Voorbeeld BV',
          language: 'nl',
          currency: 'EUR',
          country: 'NL',
          time_zone: 'Europe/Amsterdam',
        }),
      }),
      options(),
    )
    expect(plan.problems.map((problem) => problem.code)).not.toContain('fiscal_year_start_mismatch')
    expect(plan.warnings.map((warning) => warning.code)).toContain('fiscal_year_start_unknown')
  })
})

describe('the reconciliation', () => {
  it('agrees with a snapshot whose history balances', () => {
    const plan = planMoneybirdImport(snapshot(), options())
    expect(plan.problems.filter((problem) => problem.code.startsWith('trial_balance'))).toEqual([])
    expect(plan.reconciliation[0]).toMatchObject({ year: 2026, source: 'read', balanced: true })
  })

  it('does not call an unreadable source reconciled', () => {
    const plan = planMoneybirdImport(
      snapshot({
        unreadable: [
          {
            resource: 'sales_invoices.json',
            status: 403,
            message: 'Moneybird refused this token (403).',
          },
        ],
      }),
      options(),
    )
    expect(plan.warnings.map((warning) => warning.code)).toContain('resource_unreadable')
    expect(plan.reconciliation.every((year) => year.source === 'unreadable')).toBe(true)
    expect(plan.reconciliation.every((year) => year.balanced === null)).toBe(true)
  })

  it('does not call an unreadable purchase source reconciled either', () => {
    const plan = planMoneybirdImport(
      snapshot({
        unreadable: [
          {
            resource: 'documents/purchase_invoices.json',
            status: 403,
            message: 'Moneybird refused this token (403).',
          },
        ],
      }),
      options(),
    )
    expect(plan.warnings.map((warning) => warning.code)).toContain('resource_unreadable')
    expect(plan.reconciliation.every((year) => year.source === 'unreadable')).toBe(true)
    expect(plan.reconciliation.every((year) => year.balanced === null)).toBe(true)
  })

  it('keeps an acknowledged empty year as empty, never reconciled', () => {
    // A draft sales invoice still contributes a year via documents, but no
    // journal entry — so reconciliation has a real empty row (not []).
    const base = snapshot()
    const draft = { ...base.salesInvoices[0]!, state: 'draft' }
    const plan = planMoneybirdImport(
      snapshot({
        salesInvoices: [draft],
        purchaseInvoices: [],
        receipts: [],
        financialMutations: [],
        journalDocuments: [],
        generalDocuments: [],
        financialAccounts: [],
      }),
      options({
        decisions: { acknowledgedEmptyYears: ['2026'] },
      }),
    )
    expect(plan.warnings.map((warning) => warning.code)).not.toContain('trial_balance_empty')
    expect(plan.reconciliation).toHaveLength(1)
    expect(plan.reconciliation[0]).toMatchObject({
      year: 2026,
      source: 'empty',
      balanced: null,
    })
    expect(mayClaimReconciled('empty', plan.reconciliation[0]!.balanced)).toBe(false)
  })
})

describe('finding fixes on the plan', () => {
  it('puts the ledger name in unmapped_account detail, not the raw Moneybird id', () => {
    const base = snapshot()
    const emptied = base.ledgerAccounts.map((account) =>
      account.number === '8000' ? { ...account, number: '' } : account,
    )
    const omzetId = emptied.find((account) => account.name === 'Omzet')!.id
    const plan = planMoneybirdImport(
      snapshot({
        ledgerAccounts: emptied,
        salesInvoices: [
          {
            ...base.salesInvoices[0]!,
            details: base.salesInvoices[0]!.details.map((detail) => ({
              ...detail,
              ledgerAccountId: omzetId,
            })),
          },
        ],
      }),
      options(),
    )
    const unmapped = plan.problems.filter((item) => item.code === 'unmapped_account')
    expect(unmapped.length).toBeGreaterThan(0)
    for (const item of unmapped) {
      expect(item.detail['name']).toBe('Omzet')
      expect(item.detail['name']).not.toBe(item.detail['moneybirdId'])
    }
  })

  it('lists excluded documents under excluded, not as problems', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      base,
      options({
        lockedYears: ['2026'],
        decisions: { excludedLockedYears: ['2026'] },
      }),
    )
    expect(plan.problems.map((item) => item.code)).not.toContain('period_locked')
    expect(plan.excluded).toContain('period_locked:2026')
    expect(plan.excluded).toContain('sales_invoice:301')
  })

  it('excludes a single foreign document while others still post', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      base,
      options({
        decisions: { excludedExternalIds: ['sales_invoice:301'] },
      }),
    )
    expect(plan.excluded).toContain('sales_invoice:301')
    expect(plan.entries.every((entry) => entry.externalId !== 'sales_invoice:301')).toBe(true)
    expect(plan.entries.some((entry) => entry.externalId.startsWith('purchase_invoice:'))).toBe(
      true,
    )
  })

  it('applies a contact renumber override', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      base,
      options({
        existingContactNumbers: ['1001'],
        decisions: { contactNumberOverrides: { '100': '1002' } },
      }),
    )
    const contact = plan.contacts.find((item) => item.moneybirdId === '100')
    expect(contact?.number).toBe('1002')
    expect(plan.problems.map((item) => item.code)).not.toContain('contact_number_collision')
  })

  it('applies an account type override for derived types', () => {
    const base = snapshot()
    const omzetId = base.ledgerAccounts.find((account) => account.name === 'Omzet')!.id
    const withoutOverride = planMoneybirdImport(
      {
        ...base,
        ledgerAccounts: base.ledgerAccounts.map((account) =>
          account.id === omzetId
            ? { ...account, accountType: 'something_unknown', rgsCode: 'WOmzDi' }
            : account,
        ),
      },
      options(),
    )
    expect(withoutOverride.warnings.map((item) => item.code)).toContain('derived_account_type')
    const derived = withoutOverride.warnings.find((item) => item.code === 'derived_account_type')
    // RGS WOmz* → revenue suggestion for the type picker (PM follow-up).
    expect(derived?.detail['suggestedType']).toBe('revenue')

    const plan = planMoneybirdImport(
      {
        ...base,
        ledgerAccounts: base.ledgerAccounts.map((account) =>
          account.id === omzetId ? { ...account, accountType: 'something_unknown' } : account,
        ),
      },
      options({
        decisions: { accountTypeOverrides: { [omzetId]: 'revenue' } },
      }),
    )
    const omzet = plan.accounts.find((account) => account.name === 'Omzet')
    expect(omzet?.type).toBe('revenue')
    expect(plan.warnings.map((item) => item.code)).not.toContain('derived_account_type')
  })

  it('uses a per-document unknown_currency message, not the administration one', () => {
    const base = snapshot()
    const invoice = { ...base.salesInvoices[0]!, currency: 'USD' }
    const plan = planMoneybirdImport(snapshot({ salesInvoices: [invoice] }), options())
    const finding = plan.problems.find((item) => item.code === 'unknown_currency')
    expect(finding?.messageKey).toBe('moneybird.unknown_currency_document')
    expect(finding?.message).toMatch(/2026-001|is in USD/)
  })

  it('lists unbalanced year documents for TB drill-down, not only balanced entries', () => {
    const base = snapshot()
    const journal = {
      ...base.journalDocuments[0]!,
      details: base.journalDocuments[0]!.details.map((line, index) =>
        index === 1 ? { ...line, credit: 90000n, debit: 0n } : line,
      ),
    }
    const plan = planMoneybirdImport(snapshot({ journalDocuments: [journal] }), options())
    expect(plan.problems.map((item) => item.code)).toContain('unbalanced_document')
    const behind = plan.yearDocuments.filter((doc) => !doc.balanced)
    expect(behind).toHaveLength(1)
    expect(behind[0]?.externalId).toBe('journal:701')
    expect(behind[0]?.year).toBe(2026)
    expect(plan.yearDocuments.some((doc) => doc.balanced)).toBe(true)
  })

  it('defers an attachment without a URL after acknowledgement', () => {
    const base = snapshot()
    const invoice = {
      ...base.salesInvoices[0]!,
      attachments: [
        {
          ...base.salesInvoices[0]!.attachments[0]!,
          downloadUrl: null,
        },
      ],
    }
    const attachmentId = invoice.attachments[0]!.id
    const blocked = planMoneybirdImport(snapshot({ salesInvoices: [invoice] }), options())
    expect(blocked.warnings.map((item) => item.code)).toContain('attachment_without_url')

    const deferred = planMoneybirdImport(
      snapshot({ salesInvoices: [invoice] }),
      options({ decisions: { deferredAttachmentIds: [attachmentId] } }),
    )
    expect(deferred.warnings.map((item) => item.code)).not.toContain('attachment_without_url')
  })

  it('blocks a foreign-currency document until a rate is chosen', () => {
    const base = snapshot()
    const invoice = { ...base.salesInvoices[0]!, currency: 'USD' }
    const plan = planMoneybirdImport(snapshot({ salesInvoices: [invoice] }), options())
    expect(plan.problems.map((item) => item.code)).toContain('unknown_currency')
    expect(plan.entries.find((item) => item.externalId === 'sales_invoice:301')).toBeUndefined()
    expect(plan.pendingFx.some((item) => item.externalId === 'sales_invoice:301')).toBe(true)
  })

  it('applies a confirmed FX rate and stores source+date on the lines', () => {
    const base = snapshot()
    const invoice = { ...base.salesInvoices[0]!, currency: 'USD' }
    const plan = planMoneybirdImport(
      snapshot({ salesInvoices: [invoice] }),
      options({
        decisions: {
          exchangeRates: {
            'sales_invoice:301': { rate: '0.9214', source: 'ecb', date: '2026-10-16' },
          },
        },
      }),
    )
    const entry = plan.entries.find((item) => item.externalId === 'sales_invoice:301')
    expect(entry).toBeDefined()
    expect(entry!.lines.every((line) => line.exchangeRate === '0.9214')).toBe(true)
    expect(entry!.lines.every((line) => line.exchangeRateSource === 'ecb:2026-10-16')).toBe(true)
    expect(plan.problems.map((item) => item.code)).not.toContain('unknown_currency')
    expect(plan.pendingFx).toEqual([])
  })

  it('silences the missing-currency warning after one-click EUR confirmation', () => {
    const plan = planMoneybirdImport(
      snapshot({
        administration: {
          ...snapshot().administration,
          currency: null,
        },
      }),
      options({ decisions: { confirmedCurrencyIsFunctional: true } }),
    )
    expect(
      plan.warnings.filter(
        (item) => item.code === 'unknown_currency' && item.path === 'administration.currency',
      ),
    ).toEqual([])
  })

  it('silences fiscal_year_start_unknown after confirmation', () => {
    const plan = planMoneybirdImport(
      snapshot({
        administration: {
          ...snapshot().administration,
          fiscalYearStartMonth: null,
        },
      }),
      options({ decisions: { confirmedFiscalYearStart: true } }),
    )
    expect(plan.warnings.map((item) => item.code)).not.toContain('fiscal_year_start_unknown')
  })
})

/** nl-mkb zero-rate sales codes — five candidates, never auto-pick VERL (#70). */
const ZERO_SALES_RULES: readonly ExistingTaxRule[] = [
  {
    code: 'VERL',
    rateBasisPoints: 0,
    direction: 'output',
    scope: 'domestic',
    reverseCharge: 'domestic',
  },
  {
    code: 'GEEN',
    rateBasisPoints: 0,
    direction: 'output',
    scope: 'exempt',
    reverseCharge: 'none',
  },
  {
    code: 'NUL',
    rateBasisPoints: 0,
    direction: 'output',
    scope: 'export',
    reverseCharge: 'none',
  },
  {
    code: 'ICP',
    rateBasisPoints: 0,
    direction: 'output',
    scope: 'intra_community_supply',
    reverseCharge: 'none',
  },
  {
    code: 'ICPD',
    rateBasisPoints: 0,
    direction: 'output',
    scope: 'intra_community_supply',
    reverseCharge: 'none',
  },
]

const CHART_RULES: readonly ExistingTaxRule[] = [
  {
    code: 'H21',
    rateBasisPoints: 2100,
    direction: 'output',
    scope: 'domestic',
    reverseCharge: 'none',
  },
  {
    code: 'L9',
    rateBasisPoints: 900,
    direction: 'output',
    scope: 'domestic',
    reverseCharge: 'none',
  },
  {
    code: 'VH21',
    rateBasisPoints: 2100,
    direction: 'input',
    scope: 'domestic',
    reverseCharge: 'none',
  },
  {
    code: 'VL9',
    rateBasisPoints: 900,
    direction: 'input',
    scope: 'domestic',
    reverseCharge: 'none',
  },
  ...ZERO_SALES_RULES,
]

describe('VAT mapping direction and rate (#70)', () => {
  it('rejects sales mapped to a purchase code', () => {
    const plan = planMoneybirdImport(
      snapshot(),
      options({
        existingTaxRules: CHART_RULES,
        confirmedTaxMappings: { '21': 'VH21' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).toContain('incompatible_tax_rate')
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '21')).toMatchObject({
      mapped: false,
      mappedCode: null,
      proposedCode: 'H21',
    })
    const finding = plan.problems.find((item) => item.code === 'incompatible_tax_rate')
    expect(finding?.detail).toMatchObject({
      mappedCode: 'VH21',
      taxRateType: 'sales_invoice',
    })
  })

  it('rejects purchase mapped to a sales code', () => {
    const plan = planMoneybirdImport(
      snapshot(),
      options({
        existingTaxRules: CHART_RULES,
        confirmedTaxMappings: { '22': 'H21' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).toContain('incompatible_tax_rate')
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '22')).toMatchObject({
      mapped: false,
      mappedCode: null,
      proposedCode: 'VH21',
    })
  })

  it('does not auto-suggest when five 0% sales codes match (verlegd / vrijgesteld / export / ICP)', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          ...base.taxRates,
          {
            id: '30',
            name: '0% sales',
            percentage: 0,
            taxRateType: 'sales_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
      },
      options({ existingTaxRules: CHART_RULES }),
    )
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '30')).toMatchObject({
      proposedCode: null,
      mapped: false,
    })
  })

  it('accepts an explicit VERL mapping for a 0% sales rate', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '30',
            name: 'Verlegd',
            percentage: 0,
            taxRateType: 'sales_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        // Mark the rate as used so mapping matters.
        salesInvoices: base.salesInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '30' })),
        })),
      },
      options({
        existingTaxRules: CHART_RULES,
        confirmedTaxMappings: { '30': 'VERL' },
      }),
    )
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '30')).toMatchObject({
      mapped: true,
      mappedCode: 'VERL',
      proposedCode: null,
    })
    expect(plan.problems.map((item) => item.code)).not.toContain('incompatible_tax_rate')
    expect(plan.problems.map((item) => item.code)).not.toContain('unmapped_tax_rate')
  })

  it('accepts an explicit ICP mapping for a 0% sales rate', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '31',
            name: 'ICP',
            percentage: 0,
            taxRateType: 'sales_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        salesInvoices: base.salesInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '31' })),
        })),
      },
      options({
        existingTaxRules: CHART_RULES,
        confirmedTaxMappings: { '31': 'ICP' },
      }),
    )
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '31')).toMatchObject({
      mapped: true,
      mappedCode: 'ICP',
    })
  })

  it('accepts an explicit NUL (export) mapping for a 0% sales rate', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '32',
            name: 'Export',
            percentage: 0,
            taxRateType: 'sales_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        salesInvoices: base.salesInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '32' })),
        })),
      },
      options({
        existingTaxRules: CHART_RULES,
        confirmedTaxMappings: { '32': 'NUL' },
      }),
    )
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '32')).toMatchObject({
      mapped: true,
      mappedCode: 'NUL',
    })
  })

  it('never auto-maps an empty percentage and never falls back to 21%', () => {
    const base = snapshot()
    const empty = parseTaxRate({
      id: 40,
      name: 'Empty rate',
      percentage: '',
      tax_rate_type: 'sales_invoice',
      country: 'NL',
      active: true,
    })
    expect(Number.isFinite(empty.percentage)).toBe(false)
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [empty],
        salesInvoices: base.salesInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '40' })),
        })),
      },
      options({ existingTaxRules: CHART_RULES }),
    )
    const rate = plan.taxRates.find((row) => row.moneybirdId === '40')
    expect(rate?.proposedCode).toBeNull()
    expect(rate?.mappedCode).toBeNull()
    expect(rate?.proposedCode).not.toBe('H21')
  })

  it('never auto-maps a NaN percentage', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '41',
            name: 'NaN rate',
            percentage: Number.NaN,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        purchaseInvoices: base.purchaseInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '41' })),
        })),
      },
      options({ existingTaxRules: CHART_RULES }),
    )
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '41')?.proposedCode).toBeNull()
  })

  it('derives unknown direction from sales invoices and may preselect H21', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '42',
            name: 'Mystery',
            percentage: 21,
            taxRateType: 'odd_type',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        salesInvoices: base.salesInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '42' })),
        })),
      },
      options({ existingTaxRules: CHART_RULES }),
    )
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '42')).toMatchObject({
      taxRateType: 'sales_invoice',
      proposedCode: 'H21',
    })
  })

  it('still accepts a valid sales → H21 mapping', () => {
    const plan = planMoneybirdImport(
      snapshot(),
      options({
        existingTaxRules: CHART_RULES,
        confirmedTaxMappings: { '21': 'H21', '22': 'VH21' },
      }),
    )
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '21')).toMatchObject({
      mapped: true,
      mappedCode: 'H21',
    })
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '22')).toMatchObject({
      mapped: true,
      mappedCode: 'VH21',
    })
    expect(plan.problems.map((item) => item.code)).not.toContain('incompatible_tax_rate')
  })
})

describe('VAT ranking against the full nl-mkb chart (#70)', () => {
  it('loads every tax code from nl-mkb (not a subset)', () => {
    expect(nlMkbTaxRules.length).toBe(NL_MKB.taxCodes.length)
    expect(nlMkbTaxRules.length).toBeGreaterThanOrEqual(16)
    expect(nlMkbTaxRules.map((rule) => rule.code)).toEqual(
      expect.arrayContaining([
        'H21',
        'L9',
        'VH21',
        'VL9',
        'VERL',
        'GEEN',
        'NUL',
        'ICP',
        'ICPD',
        'VERL-ONTV',
        'ICV21',
        'INV23',
      ]),
    )
  })

  it('preselects H21 for 21% sales and ranks PRIV21 under other', () => {
    const plan = planMoneybirdImport(snapshot(), options({ existingTaxRules: nlMkbTaxRules }))
    const sales = plan.taxRates.find((rate) => rate.moneybirdId === '21')
    expect(sales?.proposedCode).toBe('H21')
    expect(
      sales?.candidates.filter((row) => row.group === 'primary').map((row) => row.code),
    ).toEqual(['H21'])
    expect(sales?.candidates.filter((row) => row.group === 'other').map((row) => row.code)).toEqual(
      ['PRIV21'],
    )
    expect(sales?.candidates[0]).toEqual({ code: 'H21', group: 'primary' })
  })

  it('preselects VH21 for 21% purchase; verlegd / ICP / invoer are other', () => {
    const plan = planMoneybirdImport(snapshot(), options({ existingTaxRules: nlMkbTaxRules }))
    const purchase = plan.taxRates.find((rate) => rate.moneybirdId === '22')
    expect(purchase?.proposedCode).toBe('VH21')
    expect(
      purchase?.candidates.filter((row) => row.group === 'primary').map((row) => row.code),
    ).toEqual(['VH21'])
    const other = purchase?.candidates.filter((row) => row.group === 'other').map((row) => row.code)
    expect(other).toEqual(
      expect.arrayContaining([
        'VERL-ONTV',
        'VERL-VOOR',
        'ICV21',
        'ICV21-VOOR',
        'INV23',
        'INV23-VOOR',
      ]),
    )
    expect(other).not.toContain('VH21')
    expect(purchase?.candidates[0]).toEqual({ code: 'VH21', group: 'primary' })
  })

  it('preselects L9 / VL9 for 9% sales and purchase', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '91',
            name: 'BTW laag 9%',
            percentage: 9,
            taxRateType: 'sales_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
          {
            id: '92',
            name: 'Voorbelasting laag 9%',
            percentage: 9,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
      },
      options({ existingTaxRules: nlMkbTaxRules }),
    )
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '91')?.proposedCode).toBe('L9')
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '92')?.proposedCode).toBe('VL9')
  })

  it('does not preselect any of the five 0% sales codes', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '30',
            name: '0% sales',
            percentage: 0,
            taxRateType: 'sales_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
      },
      options({ existingTaxRules: nlMkbTaxRules }),
    )
    const zero = plan.taxRates.find((rate) => rate.moneybirdId === '30')
    expect(zero?.proposedCode).toBeNull()
    expect(zero?.candidates.filter((row) => row.group === 'primary')).toEqual([])
    expect(zero?.candidates.map((row) => row.code).sort()).toEqual(
      ['GEEN', 'ICP', 'ICPD', 'NUL', 'VERL'].sort(),
    )
    expect(zero?.candidates.every((row) => row.group === 'other')).toBe(true)
  })

  it('still rejects sales → VH21 against the full chart', () => {
    const plan = planMoneybirdImport(
      snapshot(),
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '21': 'VH21' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).toContain('incompatible_tax_rate')
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '21')?.mappedCode).toBeNull()
  })

  it('rejects same-direction rate mismatches (21% sales→L9, 9% purchase→VH21)', () => {
    const base = snapshot()
    const salesMismatch = planMoneybirdImport(
      snapshot(),
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '21': 'L9' },
      }),
    )
    expect(salesMismatch.problems.map((item) => item.code)).toContain('incompatible_tax_rate')

    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '92',
            name: 'Voorbelasting laag 9%',
            percentage: 9,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        purchaseInvoices: base.purchaseInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '92' })),
        })),
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '92': 'VH21' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).toContain('incompatible_tax_rate')
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '92')?.proposedCode).toBe('VL9')
  })

  it('rejects a hand-pick on an unknown direction that cannot be derived', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '43',
            name: 'Orphan rate',
            percentage: 21,
            taxRateType: 'odd_type',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        // Unused on any document — direction cannot be derived.
        salesInvoices: base.salesInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '21' })),
        })),
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '43': 'H21' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).toContain('incompatible_tax_rate')
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '43')?.mappedCode).toBeNull()
  })

  it('rejects VH21 when unknown direction is derived as sales from invoices', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '44',
            name: 'Undeclared sales',
            percentage: 21,
            taxRateType: '',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        salesInvoices: base.salesInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '44' })),
        })),
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '44': 'VH21' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).toContain('incompatible_tax_rate')
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '44')).toMatchObject({
      taxRateType: 'sales_invoice',
      mapped: false,
      mappedCode: null,
    })
  })

  it('rejects an empty/NaN percentage hand-pick as incompatible_tax_rate', () => {
    const base = snapshot()
    const empty = parseTaxRate({
      id: 45,
      name: 'Empty rate',
      percentage: '',
      tax_rate_type: 'sales_invoice',
      country: 'NL',
      active: true,
    })
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [empty],
        salesInvoices: base.salesInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '45' })),
        })),
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '45': 'H21' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).toContain('incompatible_tax_rate')
    const finding = plan.problems.find((item) => item.code === 'incompatible_tax_rate')
    expect(finding?.detail['percentage']).toBe('—')
    expect(finding?.message).toContain('(—)')
    expect(finding?.message).not.toContain('(—%)')
    expect(finding?.message).not.toContain('(%)')
  })

  it('keeps a mixed-use unknown-direction rate undecidable (sales + purchase)', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '46',
            name: 'Both sides',
            percentage: 21,
            taxRateType: 'odd_type',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        salesInvoices: base.salesInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '46' })),
        })),
        purchaseInvoices: base.purchaseInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '46' })),
        })),
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '46': 'H21' },
      }),
    )
    const rate = plan.taxRates.find((row) => row.moneybirdId === '46')
    expect(rate?.proposedCode).toBeNull()
    expect(rate?.mappedCode).toBeNull()
    expect(rate?.taxRateType).toBe('odd_type')
    const finding = plan.problems.find((item) => item.path === 'taxRates.46')
    expect(finding).toMatchObject({
      code: 'incompatible_tax_rate',
      messageKey: 'moneybird.incompatible_tax_rate_both_sides',
    })
    expect(finding?.message).toMatch(/both sales and purchase|verkoop- én inkoop/i)
  })

  it('accepts a VH21-PRO hand-pick on a 21% purchase rate', () => {
    // Pro-rata input codes are not on nl-mkb; seed charts (and custom ones) may add them.
    const withProRata: readonly ExistingTaxRule[] = [
      ...nlMkbTaxRules,
      {
        code: 'VH21-PRO',
        rateBasisPoints: 2100,
        direction: 'input',
        scope: 'domestic',
        reverseCharge: 'none',
        deductibility: 'pro_rata',
      },
    ]
    const plan = planMoneybirdImport(
      snapshot(),
      options({
        existingTaxRules: withProRata,
        confirmedTaxMappings: { '21': 'H21', '22': 'VH21-PRO' },
      }),
    )
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '22')).toMatchObject({
      mapped: true,
      mappedCode: 'VH21-PRO',
      proposedCode: 'VH21',
    })
    expect(
      plan.taxRates
        .find((rate) => rate.moneybirdId === '22')
        ?.candidates.find((row) => row.code === 'VH21-PRO'),
    ).toEqual({ code: 'VH21-PRO', group: 'other' })
    expect(plan.problems.map((item) => item.code)).not.toContain('incompatible_tax_rate')
  })

  it('leaves 0% purchase with no candidates and unmapped_tax_rate (no V0 yet — #72)', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '50',
            name: '0% purchase',
            percentage: 0,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        purchaseInvoices: base.purchaseInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '50' })),
        })),
      },
      options({ existingTaxRules: nlMkbTaxRules }),
    )
    const rate = plan.taxRates.find((row) => row.moneybirdId === '50')
    expect(rate?.candidates).toEqual([])
    expect(rate?.proposedCode).toBeNull()
    expect(plan.problems.map((item) => item.code)).toContain('unmapped_tax_rate')
  })

  it('rejects a confirmed H21 on an unsupported 6% rate', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '60',
            name: '6%',
            percentage: 6,
            taxRateType: 'sales_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        salesInvoices: base.salesInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '60' })),
        })),
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '60': 'H21' },
      }),
    )
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '60')?.candidates).toEqual([])
    expect(plan.problems.map((item) => item.code)).toContain('incompatible_tax_rate')
  })

  it('does not preselect on a custom chart with no primary code', () => {
    const customOnlyOther: readonly ExistingTaxRule[] = [
      {
        code: 'PRIV21',
        rateBasisPoints: 2100,
        direction: 'output',
        scope: 'private_use',
        reverseCharge: 'none',
      },
      {
        code: 'CUSTOM21',
        rateBasisPoints: 2100,
        direction: 'output',
        // Missing scope/reverseCharge → other, never primary.
      },
    ]
    const plan = planMoneybirdImport(snapshot(), options({ existingTaxRules: customOnlyOther }))
    const sales = plan.taxRates.find((rate) => rate.moneybirdId === '21')
    expect(sales?.proposedCode).toBeNull()
    expect(sales?.candidates.every((row) => row.group === 'other')).toBe(true)
    expect(sales?.candidates.map((row) => row.code).sort()).toEqual(['CUSTOM21', 'PRIV21'])
  })

  it('findIncompatibleTaxMappings flags wrong-direction picks for save-time rejection', () => {
    const found = findIncompatibleTaxMappings(snapshot(), nlMkbTaxRules, {
      '21': 'VH21',
      '22': 'VH21',
    })
    expect(found.map((item) => item.path)).toContain('taxRates.21')
    expect(found.map((item) => item.path)).not.toContain('taxRates.22')
    expect(found.every((item) => item.code === 'incompatible_tax_rate')).toBe(true)
  })
})
