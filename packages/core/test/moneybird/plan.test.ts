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
      'credit_note',
      'credit_note',
      'journal',
      'purchase_invoice',
      'purchase_invoice',
      'purchase_invoice',
      'sales_invoice',
      'sales_invoice',
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

  it('skips unselected wizard years without raising period_locked (#100)', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      base,
      options({
        decisions: { excludedYears: ['2026'] },
      }),
    )
    expect(plan.problems.map((item) => item.code)).not.toContain('period_locked')
    expect(plan.entries.every((entry) => String(entry.year) !== '2026')).toBe(true)
    expect(plan.excluded.some((id) => id.includes('sales_invoice') || id.includes('301'))).toBe(
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
          // Plausible 0% document: totalTax matches null-rate lines at 0% (#90 PM).
          totalTax: 0n,
          totalIncl: invoice.totalExcl,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '40' })),
        })),
      },
      options({ existingTaxRules: CHART_RULES }),
    )
    const rate = plan.taxRates.find((row) => row.moneybirdId === '40')
    expect(rate?.proposedCode).toBeNull()
    expect(rate?.mappedCode).toBeNull()
    expect(rate?.proposedCode).not.toBe('H21')
    // Missing % is matched as 0% candidates (sales other codes), never auto-confirmed (#90).
    expect(rate?.candidates.some((row) => row.code === 'H21')).toBe(false)
    expect(rate?.candidates.map((row) => row.code)).toEqual(
      expect.arrayContaining(['VERL', 'GEEN', 'NUL', 'ICP', 'ICPD']),
    )
    expect(rate?.proposedCode).toBeNull()
    expect(plan.problems.map((item) => item.code)).toContain('unmapped_tax_rate')
  })

  it('never auto-maps a NaN percentage but offers purchase 0% candidates', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '41',
            name: 'Geen btw',
            percentage: Number.NaN,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        purchaseInvoices: base.purchaseInvoices.map((invoice) => ({
          ...invoice,
          totalTax: 0n,
          totalIncl: invoice.totalExcl,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '41' })),
        })),
      },
      options({ existingTaxRules: nlMkbTaxRules }),
    )
    const rate = plan.taxRates.find((row) => row.moneybirdId === '41')
    expect(rate?.proposedCode).toBeNull()
    expect(rate?.candidates).toEqual([{ code: 'VGEEN', group: 'other' }])
    expect(plan.problems.map((item) => item.code)).toContain('unmapped_tax_rate')
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
        'L6',
        'H19',
        'VH21',
        'VL9',
        'VL6',
        'VH19',
        'VGEEN',
        'VERL',
        'GEEN',
        'NUL',
        'ICP',
        'ICPD',
        'VERL-ONTV',
        'VERL9-ONTV',
        'ICV21',
        'ICV9',
        'INV23',
        'INV9',
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

  it('rejects a 21% hand-pick on an empty/NaN percentage (matched as 0%)', () => {
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

  it('accepts a confirmed 0% mapping for null/missing/empty percentage and unblocks all docs', () => {
    const base = snapshot()
    const nullRate = parseTaxRate({
      id: 90,
      name: 'Geen btw',
      percentage: null,
      tax_rate_type: 'purchase_invoice',
      country: 'NL',
      active: true,
    })
    const missing = parseTaxRate({
      id: 91,
      name: 'Geen btw missing',
      tax_rate_type: 'purchase_invoice',
      country: 'NL',
      active: true,
    })
    const empty = parseTaxRate({
      id: 92,
      name: 'Geen btw empty',
      percentage: '',
      tax_rate_type: 'purchase_invoice',
      country: 'NL',
      active: true,
    })
    for (const rate of [nullRate, missing, empty]) {
      expect(Number.isFinite(rate.percentage)).toBe(false)
    }
    const confirmed = planMoneybirdImport(
      {
        ...base,
        taxRates: [nullRate, missing, empty],
        purchaseInvoices: [
          {
            ...base.purchaseInvoices[0]!,
            id: 'p-null',
            totalTax: 0n,
            totalIncl: base.purchaseInvoices[0]!.totalExcl,
            details: base.purchaseInvoices[0]!.details.map((detail) => ({
              ...detail,
              taxRateId: '90',
            })),
          },
          {
            ...base.purchaseInvoices[0]!,
            id: 'p-missing',
            totalTax: 0n,
            totalIncl: base.purchaseInvoices[0]!.totalExcl,
            details: base.purchaseInvoices[0]!.details.map((detail) => ({
              ...detail,
              taxRateId: '91',
            })),
          },
          {
            ...base.purchaseInvoices[0]!,
            id: 'p-empty',
            totalTax: 0n,
            totalIncl: base.purchaseInvoices[0]!.totalExcl,
            details: base.purchaseInvoices[0]!.details.map((detail) => ({
              ...detail,
              taxRateId: '92',
            })),
          },
        ],
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '90': 'VGEEN', '91': 'VGEEN', '92': 'VGEEN' },
      }),
    )
    for (const id of ['90', '91', '92']) {
      expect(confirmed.taxRates.find((row) => row.moneybirdId === id)).toMatchObject({
        mapped: true,
        mappedCode: 'VGEEN',
        proposedCode: null,
        percentage: '—',
      })
    }
    expect(confirmed.problems.map((item) => item.code)).not.toContain('unmapped_tax_rate')
    expect(confirmed.problems.map((item) => item.code)).not.toContain('incompatible_tax_rate')
    expect(confirmed.problems.map((item) => item.code)).not.toContain(
      'null_percentage_vat_mismatch',
    )
  })

  it('blocks a null-% purchase whose document still carries VAT and refuses VGEEN', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '95',
            name: 'Geen btw',
            percentage: Number.NaN,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        purchaseInvoices: base.purchaseInvoices.map((invoice) => ({
          ...invoice,
          // Keep Moneybird's 21 totalTax while the rate has no percentage.
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '95' })),
        })),
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '95': 'VGEEN' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).toContain('null_percentage_vat_mismatch')
    expect(plan.problems.map((item) => item.code)).toContain('incompatible_tax_rate')
    const mismatch = plan.problems.find((item) => item.code === 'null_percentage_vat_mismatch')
    expect(mismatch?.detail['references']).toContain('LEV-88')
    expect(plan.taxRates.find((row) => row.moneybirdId === '95')).toMatchObject({
      mapped: false,
      mappedCode: null,
      candidates: [],
      proposedCode: null,
    })
  })

  it('blocks a null-% sales document whose totalTax does not match 0% lines', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '96',
            name: 'Geen btw verkoop',
            percentage: Number.NaN,
            taxRateType: 'sales_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        salesInvoices: base.salesInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '96' })),
        })),
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '96': 'GEEN' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).toContain('null_percentage_vat_mismatch')
    expect(plan.problems.map((item) => item.code)).toContain('incompatible_tax_rate')
    const mismatch = plan.problems.find((item) => item.code === 'null_percentage_vat_mismatch')
    expect(mismatch?.detail['references']).toContain('2026-001')
    expect(plan.taxRates.find((row) => row.moneybirdId === '96')).toMatchObject({
      mapped: false,
      candidates: [],
      proposedCode: null,
    })
  })

  it('allows a mixed null-% + taxed document when totalTax matches half-up within 1¢/line', () => {
    // €0.08 × 21% = 1.68¢ → truncated 1, half-up 2. Tolerance must not block (#90 PM).
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          ...base.taxRates,
          {
            id: '97',
            name: 'Geen btw',
            percentage: Number.NaN,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        purchaseInvoices: [
          {
            ...base.purchaseInvoices[0]!,
            totalTax: 2n,
            totalExcl: 10008n,
            totalIncl: 10010n,
            pricesAreInclTax: false,
            details: [
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'mixed-taxed',
                price: 8n,
                taxRateId: '22',
              },
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'mixed-null',
                price: 10000n,
                taxRateId: '97',
              },
            ],
          },
        ],
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '97': 'VGEEN' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).not.toContain('null_percentage_vat_mismatch')
    expect(plan.taxRates.find((row) => row.moneybirdId === '97')).toMatchObject({
      mapped: true,
      mappedCode: 'VGEEN',
    })
  })

  it('blocks a mixed null-% + taxed document when VAT exceeds half-up + 1¢/line', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          ...base.taxRates,
          {
            id: '98',
            name: 'Geen btw',
            percentage: Number.NaN,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        purchaseInvoices: [
          {
            ...base.purchaseInvoices[0]!,
            // Expected half-up on €100 @ 21% = 2100; +21 as if the null line were taxed too.
            totalTax: 2121n,
            totalExcl: 20000n,
            totalIncl: 22121n,
            pricesAreInclTax: false,
            details: [
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'over-taxed',
                price: 10000n,
                taxRateId: '22',
              },
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'over-null',
                price: 10000n,
                taxRateId: '98',
              },
            ],
          },
        ],
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '98': 'VGEEN' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).toContain('null_percentage_vat_mismatch')
    expect(plan.taxRates.find((row) => row.moneybirdId === '98')).toMatchObject({
      mapped: false,
      candidates: [],
      proposedCode: null,
    })
  })

  it('accepts an excl-VAT purchase mixed document when totalTax matches half-up', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          ...base.taxRates,
          {
            id: '99',
            name: 'Geen btw',
            percentage: Number.NaN,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        purchaseInvoices: [
          {
            ...base.purchaseInvoices[0]!,
            totalTax: 2100n,
            totalExcl: 15000n,
            totalIncl: 17100n,
            pricesAreInclTax: false,
            details: [
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'excl-taxed',
                price: 10000n,
                taxRateId: '22',
              },
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'excl-null',
                price: 5000n,
                taxRateId: '99',
              },
            ],
          },
        ],
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '99': 'VGEEN' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).not.toContain('null_percentage_vat_mismatch')
  })

  it('accepts an incl-VAT purchase mixed document using prices_are_incl_tax', () => {
    // Gross €121 @ 21% → half-up tax 2100. Treating price as net would expect ~2541 and block.
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          ...base.taxRates,
          {
            id: '100',
            name: 'Geen btw',
            percentage: Number.NaN,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        purchaseInvoices: [
          {
            ...base.purchaseInvoices[0]!,
            totalTax: 2100n,
            totalExcl: 15000n,
            totalIncl: 17100n,
            pricesAreInclTax: true,
            details: [
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'incl-taxed',
                price: 12100n,
                taxRateId: '22',
              },
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'incl-null',
                price: 5000n,
                taxRateId: '100',
              },
            ],
          },
        ],
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '100': 'VGEEN' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).not.toContain('null_percentage_vat_mismatch')
    expect(plan.taxRates.find((row) => row.moneybirdId === '100')).toMatchObject({
      mapped: true,
      mappedCode: 'VGEEN',
    })
  })

  it('allows a mixed document with a negative discount line (signed VAT)', () => {
    // €100 @ 21% = 2100; −€10 @ 21% = −210; expected 1890. Abs-sum would expect 2310 and block.
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          ...base.taxRates,
          {
            id: '101',
            name: 'Geen btw',
            percentage: Number.NaN,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        purchaseInvoices: [
          {
            ...base.purchaseInvoices[0]!,
            totalTax: 1890n,
            totalExcl: 9500n,
            totalIncl: 11390n,
            pricesAreInclTax: false,
            details: [
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'disc-main',
                price: 10000n,
                amount: '1',
                taxRateId: '22',
              },
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'disc-discount',
                description: 'Korting',
                price: -1000n,
                amount: '1',
                taxRateId: '22',
              },
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'disc-null',
                price: 500n,
                amount: '1',
                taxRateId: '101',
              },
            ],
          },
        ],
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '101': 'VGEEN', '22': 'VH21' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).not.toContain('null_percentage_vat_mismatch')
    const entry = plan.entries.find((item) => item.externalId === 'purchase_invoice:401')
    const discount = entry?.lines.find((item) => item.description === 'Korting')
    // Discount line posts on the credit side of the expense account.
    expect(discount?.credit).toBe(1000n)
    expect(discount?.taxAmount).toBe(-210n)
  })

  it('allows a mixed document with a fractional quantity (2.5 hours)', () => {
    // €40 × 2.5 @ 21% = 2100. Math.round(2.5)=3 would expect 2520 and block.
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          ...base.taxRates,
          {
            id: '102',
            name: 'Geen btw',
            percentage: Number.NaN,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        purchaseInvoices: [
          {
            ...base.purchaseInvoices[0]!,
            totalTax: 2100n,
            totalExcl: 10500n,
            totalIncl: 12600n,
            pricesAreInclTax: false,
            details: [
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'frac-taxed',
                price: 4000n,
                amount: '2.5',
                taxRateId: '22',
              },
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'frac-null',
                price: 500n,
                amount: '1',
                taxRateId: '102',
              },
            ],
          },
        ],
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '102': 'VGEEN', '22': 'VH21' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).not.toContain('null_percentage_vat_mismatch')
    const entry = plan.entries.find((item) => item.externalId === 'purchase_invoice:401')
    const taxed = entry?.lines.find((item) => item.taxAmount === 2100n)
    expect(taxed?.debit).toBe(10000n)
  })

  it('allows a credit note with negative totals on a null-% rate (signed VAT)', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          ...base.taxRates,
          {
            id: '103',
            name: 'Geen btw verkoop',
            percentage: Number.NaN,
            taxRateType: 'sales_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        salesInvoices: [
          {
            ...base.salesInvoices[0]!,
            totalTax: -2100n,
            totalExcl: -15000n,
            totalIncl: -17100n,
            originalSalesInvoiceId: '301',
            details: [
              {
                ...base.salesInvoices[0]!.details[0]!,
                id: 'cn-taxed',
                price: -10000n,
                amount: '1',
                taxRateId: '21',
              },
              {
                ...base.salesInvoices[0]!.details[0]!,
                id: 'cn-null',
                price: -5000n,
                amount: '1',
                taxRateId: '103',
              },
            ],
          },
        ],
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '103': 'GEEN', '21': 'H21' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).not.toContain('null_percentage_vat_mismatch')
    const entry = plan.entries.find((item) => item.kind === 'credit_note')
    expect(entry).toBeDefined()
    const revenue = entry?.lines.find((item) => item.taxAmount === -2100n)
    expect(revenue?.debit).toBe(10000n)
  })

  it('half-ups an exact half-cent line VAT in the check and when posting', () => {
    // €0.50 × 21% = 10.5¢ → half-up 11. Truncation would yield 10.
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          ...base.taxRates,
          {
            id: '104',
            name: 'Geen btw',
            percentage: Number.NaN,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        purchaseInvoices: [
          {
            ...base.purchaseInvoices[0]!,
            totalTax: 11n,
            totalExcl: 550n,
            totalIncl: 561n,
            pricesAreInclTax: false,
            details: [
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'half-taxed',
                price: 50n,
                amount: '1',
                taxRateId: '22',
              },
              {
                ...base.purchaseInvoices[0]!.details[0]!,
                id: 'half-null',
                price: 500n,
                amount: '1',
                taxRateId: '104',
              },
            ],
          },
        ],
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '104': 'VGEEN', '22': 'VH21' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).not.toContain('null_percentage_vat_mismatch')
    const entry = plan.entries.find((item) => item.externalId === 'purchase_invoice:401')
    expect(entry?.lines.some((item) => item.taxAmount === 11n)).toBe(true)
  })

  it('does not suggest VGEEN for a null-percentage reverse-charge purchase name', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '93',
            name: 'BTW verlegd naar u',
            percentage: Number.NaN,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
          {
            id: '94',
            name: 'ICP intracommunautair EU',
            percentage: Number.NaN,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        purchaseInvoices: base.purchaseInvoices.map((invoice) => ({
          ...invoice,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '93' })),
        })),
      },
      options({ existingTaxRules: nlMkbTaxRules }),
    )
    for (const id of ['93', '94']) {
      const rate = plan.taxRates.find((row) => row.moneybirdId === id)
      expect(rate?.proposedCode).toBeNull()
      expect(rate?.candidates.map((row) => row.code)).not.toContain('VGEEN')
    }
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

  it('offers no candidates for a 0% verlegd / ICV / import purchase rate', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '51',
            name: 'BTW verlegd naar u',
            percentage: 0,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
          {
            id: '52',
            name: 'Intracommunautaire verwerving',
            percentage: 0,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: 'ICV',
          },
          {
            id: '53',
            name: 'Invoer artikel 23',
            percentage: 0,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
      },
      options({ existingTaxRules: nlMkbTaxRules }),
    )
    for (const id of ['51', '52', '53']) {
      const rate = plan.taxRates.find((row) => row.moneybirdId === id)
      expect(rate?.candidates).toEqual([])
      expect(rate?.proposedCode).toBeNull()
      expect(rate?.candidates.map((row) => row.code)).not.toContain('VGEEN')
    }
  })

  it('offers VGEEN for a 0% purchase rate without preselecting it', () => {
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
    expect(rate?.candidates).toEqual([{ code: 'VGEEN', group: 'other' }])
    expect(rate?.proposedCode).toBeNull()
    // Like 0% sales: a candidate exists but nothing is pre-selected, so the
    // rate stays unmapped until the user confirms VGEEN.
    expect(plan.problems.map((item) => item.code)).toContain('unmapped_tax_rate')

    const confirmed = planMoneybirdImport(
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
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '50': 'VGEEN' },
      }),
    )
    expect(confirmed.taxRates.find((row) => row.moneybirdId === '50')).toMatchObject({
      mapped: true,
      mappedCode: 'VGEEN',
      proposedCode: null,
    })
    expect(confirmed.problems.map((item) => item.code)).not.toContain('unmapped_tax_rate')
  })

  it('preselects L6 for a 6% sales rate and rejects a confirmed H21 on it', () => {
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
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '60')?.candidates).toEqual([
      { code: 'L6', group: 'primary' },
    ])
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '60')?.proposedCode).toBe('L6')
    expect(plan.problems.map((item) => item.code)).toContain('incompatible_tax_rate')
  })

  it('preselects VL6 / VH19 for historical 6% and 19% purchase rates', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '66',
            name: 'Voorbelasting 6%',
            percentage: 6,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
          {
            id: '69',
            name: 'Voorbelasting 19%',
            percentage: 19,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
      },
      options({ existingTaxRules: nlMkbTaxRules }),
    )
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '66')?.proposedCode).toBe('VL6')
    expect(plan.taxRates.find((rate) => rate.moneybirdId === '69')?.proposedCode).toBe('VH19')
  })

  it('does not preselect L6 or VL6 when a 6% rate has unknown direction', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '61',
            name: '6% unknown',
            percentage: 6,
            taxRateType: 'other',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        salesInvoices: [],
        purchaseInvoices: [],
        receipts: [],
      },
      options({ existingTaxRules: nlMkbTaxRules }),
    )
    const rate = plan.taxRates.find((row) => row.moneybirdId === '61')
    expect(rate?.proposedCode).toBeNull()
    expect(rate?.candidates).toEqual([])
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

  it('tags VAT control lines with taxRole tax per mapped code (#94)', () => {
    const plan = planMoneybirdImport(
      snapshot(),
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '21': 'H21', '22': 'VH21' },
      }),
    )
    const sale = plan.entries.find((entry) => entry.externalId === 'sales_invoice:301')
    const saleVat = sale?.lines.filter((item) => item.accountNumber === '1500')
    expect(saleVat).toEqual([
      expect.objectContaining({
        credit: 2100n,
        taxCode: 'H21',
        taxRole: 'tax',
        taxAmount: 2100n,
      }),
    ])

    const purchase = plan.entries.find((entry) => entry.externalId === 'purchase_invoice:401')
    const purchaseVat = purchase?.lines.filter((item) => item.accountNumber === '1510')
    expect(purchaseVat).toEqual([
      expect.objectContaining({
        debit: 2100n,
        taxCode: 'VH21',
        taxRole: 'tax',
        taxAmount: 2100n,
      }),
    ])
  })

  it('splits a mixed-rate document into one tagged VAT line per code', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          ...base.taxRates,
          {
            id: '29',
            name: 'BTW laag 9%',
            percentage: 9,
            taxRateType: 'sales_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        salesInvoices: [
          {
            ...base.salesInvoices[0]!,
            totalTax: 3000n,
            totalExcl: 20000n,
            totalIncl: 23000n,
            details: [
              {
                ...base.salesInvoices[0]!.details[0]!,
                id: 'mix-h21',
                price: 10000n,
                amount: '1',
                taxRateId: '21',
              },
              {
                ...base.salesInvoices[0]!.details[0]!,
                id: 'mix-l9',
                price: 10000n,
                amount: '1',
                taxRateId: '29',
              },
            ],
          },
        ],
      },
      options({
        existingTaxRules: nlMkbTaxRules,
        confirmedTaxMappings: { '21': 'H21', '29': 'L9' },
      }),
    )
    const sale = plan.entries.find((entry) => entry.externalId === 'sales_invoice:301')
    const vatLines = sale?.lines
      .filter((item) => item.taxRole === 'tax')
      .sort((a, b) => (a.taxCode ?? '').localeCompare(b.taxCode ?? ''))
    expect(vatLines).toEqual([
      expect.objectContaining({ taxCode: 'H21', taxRole: 'tax', credit: 2100n, taxAmount: 2100n }),
      expect.objectContaining({ taxCode: 'L9', taxRole: 'tax', credit: 900n, taxAmount: 900n }),
    ])
  })

  it('blocks reverse-charge / intra-EU purchase mappings until #95', () => {
    const base = snapshot()
    // Moneybird books these at 0% on the document; Klopt's paired code is 21%.
    // Matching uses the Moneybird percentage, so the chart rule in the test is
    // 0% — same shape the import sees after a user confirms the mapping.
    const rules: readonly ExistingTaxRule[] = [
      ...nlMkbTaxRules.filter((rule) => rule.code !== 'VERL-ONTV' && rule.code !== 'VERL-VOOR'),
      {
        code: 'VERL-ONTV',
        rateBasisPoints: 0,
        direction: 'input',
        scope: 'domestic',
        reverseCharge: 'domestic',
        deductionCode: 'VERL-VOOR',
      },
      {
        code: 'VERL-VOOR',
        rateBasisPoints: 0,
        direction: 'input',
        scope: 'domestic',
        reverseCharge: 'none',
        deductibility: 'full',
      },
    ]
    const plan = planMoneybirdImport(
      {
        ...base,
        taxRates: [
          {
            id: '80',
            name: 'Verlegd naar u',
            percentage: 0,
            taxRateType: 'purchase_invoice',
            country: 'NL',
            active: true,
            reportReference: null,
          },
        ],
        purchaseInvoices: base.purchaseInvoices.map((invoice) => ({
          ...invoice,
          totalTax: 0n,
          totalExcl: 10000n,
          totalIncl: 10000n,
          details: invoice.details.map((detail) => ({ ...detail, taxRateId: '80' })),
        })),
      },
      options({
        existingTaxRules: rules,
        confirmedTaxMappings: { '80': 'VERL-ONTV' },
      }),
    )
    // Warning only — document still imports; filing is blocked on the return (#96 PM).
    expect(plan.problems.map((item) => item.code)).not.toContain('self_assessed_vat_unsupported')
    expect(plan.warnings.map((item) => item.code)).toContain('self_assessed_vat_unsupported')
    const finding = plan.warnings.find((item) => item.code === 'self_assessed_vat_unsupported')
    expect(finding?.detail?.['taxCode']).toBe('VERL-ONTV')
    expect(finding?.message).toMatch(
      /will import|wordt wel|filing deadline|aangiftetermijn|supports this|ondersteunt/i,
    )
    expect(finding?.message).not.toMatch(
      /book .* by hand|boek .* zelf|wait for the update|wacht op de update|Wait until Klopt supports this\.?$|Wacht tot Klopt dit ondersteunt\.?$/i,
    )
    expect(plan.entries.some((entry) => entry.kind === 'purchase_invoice')).toBe(true)
  })

  it('blocks when a document date falls before the tax code valid_from', () => {
    const base = snapshot()
    const plan = planMoneybirdImport(
      {
        ...base,
        salesInvoices: base.salesInvoices.map((invoice) => ({
          ...invoice,
          invoiceDate: '2025-06-15',
        })),
      },
      options({
        existingTaxRules: nlMkbTaxRules.map((rule) =>
          rule.code === 'H21' ? { ...rule, validFrom: '2026-01-01', validTo: null } : rule,
        ),
        confirmedTaxMappings: { '21': 'H21', '22': 'VH21' },
      }),
    )
    expect(plan.problems.map((item) => item.code)).toContain('tax_code_not_in_force')
    const finding = plan.problems.find((item) => item.code === 'tax_code_not_in_force')
    expect(finding?.detail).toMatchObject({
      taxCode: 'H21',
      bookingDate: '2025-06-15',
    })
    expect(finding?.message).toMatch(/does not apply yet|no fix inside Klopt|Moneybird/i)
    expect(finding?.message).not.toMatch(
      /valid from|geldig vanaf|Btw-codes|year whose codes|jaar waarvan/i,
    )
  })
})

/**
 * Full-entry posting pins for signed line amounts (#90 / #91 PM addendum).
 * VAT control lines on 1500/1510 are tagged per mapped code (#94).
 */
describe('Moneybird posting pins (signed lines, #91 PM)', () => {
  type LinePin = {
    readonly accountNumber: string
    readonly debit: bigint
    readonly credit: bigint
    readonly taxCode: string | null
    readonly taxAmount: bigint | null
  }

  const mapped = options({
    existingTaxRules: nlMkbTaxRules,
    confirmedTaxMappings: { '21': 'H21', '22': 'VH21' },
  })

  function pinLines(
    entry: { readonly lines: readonly LinePin[] } | undefined,
    expected: readonly LinePin[],
  ): void {
    expect(entry).toBeDefined()
    expect(
      entry!.lines.map((line) => ({
        accountNumber: line.accountNumber,
        debit: line.debit,
        credit: line.credit,
        taxCode: line.taxCode,
        taxAmount: line.taxAmount,
      })),
    ).toEqual(expected)
    const debit = entry!.lines.reduce((sum, line) => sum + line.debit, 0n)
    const credit = entry!.lines.reduce((sum, line) => sum + line.credit, 0n)
    expect(debit).toBe(credit)
  }

  function expectBalanced(plan: ReturnType<typeof planMoneybirdImport>): void {
    expect(plan.problems.map((item) => item.code)).not.toContain('unbalanced_document')
  }

  it('pins a normal sales invoice (€100 + 21% VAT)', () => {
    const plan = planMoneybirdImport(
      snapshot({
        purchaseInvoices: [],
        receipts: [],
        financialMutations: [],
        journalDocuments: [],
      }),
      mapped,
    )
    pinLines(
      plan.entries.find((item) => item.kind === 'sales_invoice'),
      [
        { accountNumber: '1300', debit: 12100n, credit: 0n, taxCode: null, taxAmount: null },
        { accountNumber: '8000', debit: 0n, credit: 10000n, taxCode: 'H21', taxAmount: 2100n },
        { accountNumber: '1500', debit: 0n, credit: 2100n, taxCode: 'H21', taxAmount: 2100n },
      ],
    )
    expectBalanced(plan)
  })

  it('pins a normal purchase invoice (€100 + 21% VAT)', () => {
    const plan = planMoneybirdImport(
      snapshot({ salesInvoices: [], receipts: [], financialMutations: [], journalDocuments: [] }),
      mapped,
    )
    pinLines(
      plan.entries.find((item) => item.kind === 'purchase_invoice'),
      [
        { accountNumber: '4000', debit: 10000n, credit: 0n, taxCode: 'VH21', taxAmount: 2100n },
        { accountNumber: '1510', debit: 2100n, credit: 0n, taxCode: 'VH21', taxAmount: 2100n },
        { accountNumber: '1600', debit: 0n, credit: 12100n, taxCode: null, taxAmount: null },
      ],
    )
    expectBalanced(plan)
  })

  it('pins a sales credit note (−€100 + VAT −€21)', () => {
    const base = snapshot()
    const credit = base.salesInvoices.find((item) => item.id === '303')!
    const plan = planMoneybirdImport(
      {
        ...base,
        purchaseInvoices: [],
        receipts: [],
        financialMutations: [],
        journalDocuments: [],
        salesInvoices: [credit],
      },
      mapped,
    )
    pinLines(
      plan.entries.find((item) => item.kind === 'credit_note'),
      [
        { accountNumber: '1300', debit: 0n, credit: 12100n, taxCode: null, taxAmount: null },
        { accountNumber: '8000', debit: 10000n, credit: 0n, taxCode: 'H21', taxAmount: -2100n },
        { accountNumber: '1500', debit: 2100n, credit: 0n, taxCode: 'H21', taxAmount: -2100n },
      ],
    )
    expectBalanced(plan)
    expect(plan.problems).toEqual([])
  })

  it('pins a sales credit note linked by originalSalesInvoiceId with positive amounts', () => {
    const base = snapshot()
    const linked = base.salesInvoices.find((item) => item.id === '304')!
    expect(linked.originalSalesInvoiceId).toBe('301')
    expect(linked.totalExcl).toBeGreaterThan(0n)
    const plan = planMoneybirdImport(
      {
        ...base,
        purchaseInvoices: [],
        receipts: [],
        financialMutations: [],
        journalDocuments: [],
        salesInvoices: [linked],
      },
      mapped,
    )
    // Same reversal as main: Cr 1300 121 / Dr 8000 100 / Dr 1500 21.
    pinLines(
      plan.entries.find((item) => item.kind === 'credit_note'),
      [
        { accountNumber: '1300', debit: 0n, credit: 12100n, taxCode: null, taxAmount: null },
        { accountNumber: '8000', debit: 10000n, credit: 0n, taxCode: 'H21', taxAmount: -2100n },
        { accountNumber: '1500', debit: 2100n, credit: 0n, taxCode: 'H21', taxAmount: -2100n },
      ],
    )
    expectBalanced(plan)
    // executeMoneybirdImport throws MoneybirdPlanRefused on any plan.problems.
    expect(plan.problems).toEqual([])
  })

  it('pins a purchase credit note (−€100 + VAT −€21)', () => {
    const base = snapshot()
    const credit = base.purchaseInvoices.find((item) => item.id === '402')!
    const plan = planMoneybirdImport(
      {
        ...base,
        salesInvoices: [],
        receipts: [],
        financialMutations: [],
        journalDocuments: [],
        purchaseInvoices: [credit],
      },
      mapped,
    )
    pinLines(
      plan.entries.find((item) => item.kind === 'purchase_invoice'),
      [
        { accountNumber: '4000', debit: 0n, credit: 10000n, taxCode: 'VH21', taxAmount: -2100n },
        { accountNumber: '1510', debit: 0n, credit: 2100n, taxCode: 'VH21', taxAmount: -2100n },
        { accountNumber: '1600', debit: 12100n, credit: 0n, taxCode: null, taxAmount: null },
      ],
    )
    expectBalanced(plan)
    expect(plan.problems).toEqual([])
  })

  it('pins a sales invoice with a discount line (+€100, −€10, VAT €18.90)', () => {
    const base = snapshot()
    const discounted = base.salesInvoices.find((item) => item.id === '305')!
    const plan = planMoneybirdImport(
      {
        ...base,
        purchaseInvoices: [],
        receipts: [],
        financialMutations: [],
        journalDocuments: [],
        salesInvoices: [discounted],
      },
      mapped,
    )
    pinLines(
      plan.entries.find((item) => item.kind === 'sales_invoice'),
      [
        { accountNumber: '1300', debit: 10890n, credit: 0n, taxCode: null, taxAmount: null },
        { accountNumber: '8000', debit: 0n, credit: 10000n, taxCode: 'H21', taxAmount: 2100n },
        { accountNumber: '8000', debit: 1000n, credit: 0n, taxCode: 'H21', taxAmount: -210n },
        { accountNumber: '1500', debit: 0n, credit: 1890n, taxCode: 'H21', taxAmount: 1890n },
      ],
    )
    expectBalanced(plan)
    expect(plan.problems).toEqual([])
  })

  it('pins a purchase invoice with a discount line (+€100, −€10, VAT €18.90)', () => {
    const base = snapshot()
    const discounted = base.purchaseInvoices.find((item) => item.id === '403')!
    const plan = planMoneybirdImport(
      {
        ...base,
        salesInvoices: [],
        receipts: [],
        financialMutations: [],
        journalDocuments: [],
        purchaseInvoices: [discounted],
      },
      mapped,
    )
    pinLines(
      plan.entries.find((item) => item.kind === 'purchase_invoice'),
      [
        { accountNumber: '4000', debit: 10000n, credit: 0n, taxCode: 'VH21', taxAmount: 2100n },
        { accountNumber: '4000', debit: 0n, credit: 1000n, taxCode: 'VH21', taxAmount: -210n },
        { accountNumber: '1510', debit: 1890n, credit: 0n, taxCode: 'VH21', taxAmount: 1890n },
        { accountNumber: '1600', debit: 0n, credit: 10890n, taxCode: null, taxAmount: null },
      ],
    )
    expectBalanced(plan)
    expect(plan.problems).toEqual([])
  })

  it('pins a sales invoice with fractional quantity 2.5 (exact amount, half-up VAT)', () => {
    const base = snapshot()
    const fractional = base.salesInvoices.find((item) => item.id === '306')!
    const plan = planMoneybirdImport(
      {
        ...base,
        purchaseInvoices: [],
        receipts: [],
        financialMutations: [],
        journalDocuments: [],
        salesInvoices: [fractional],
      },
      mapped,
    )
    pinLines(
      plan.entries.find((item) => item.kind === 'sales_invoice'),
      [
        { accountNumber: '1300', debit: 12100n, credit: 0n, taxCode: null, taxAmount: null },
        { accountNumber: '8000', debit: 0n, credit: 10000n, taxCode: 'H21', taxAmount: 2100n },
        { accountNumber: '1500', debit: 0n, credit: 2100n, taxCode: 'H21', taxAmount: 2100n },
      ],
    )
    expectBalanced(plan)
    expect(plan.problems).toEqual([])
  })
})
