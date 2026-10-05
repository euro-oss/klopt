import { describe, expect, it } from 'vitest'
import {
  planMoneybirdImport,
  parseAdministration,
  type MoneybirdImportOptions,
} from '../../src/index.js'
import { snapshot, snapshotV2 } from './fixture.js'

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
})
