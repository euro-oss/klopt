import { describe, expect, it, vi } from 'vitest'
import type { FindingMessageKey, MoneybirdProblem } from '@klopt/core'
import {
  moneybirdFindingCard,
  moneybirdFixTypeFor,
  type MoneybirdFindingActions,
} from '../../src/lib/moneybird-findings.js'
import { honestyFromReconciliation } from '../../src/lib/finding-card.js'

const CODES = [
  'unmapped_account',
  'unmapped_tax_rate',
  'incompatible_tax_rate',
  'null_percentage_vat_mismatch',
  'self_assessed_vat_unsupported',
  'tax_code_not_in_force',
  'trial_balance_account_missing',
  'account_number_collision',
  'contact_number_collision',
  'derived_account_type',
  'fiscal_year_start_unknown',
  'fiscal_year_start_mismatch',
  'resource_unreadable',
  'trial_balance_empty',
  'trial_balance_unbalanced',
  'period_locked',
  'unbalanced_document',
  'attachment_without_url',
  'draft_skipped',
] as const

function problem(
  code: (typeof CODES)[number] | 'unknown_currency',
  path: string | null,
  detail: Record<string, string> = {},
): Pick<MoneybirdProblem, 'code' | 'path' | 'detail' | 'message' | 'messageKey'> {
  return {
    code,
    path,
    messageKey: `moneybird.${code}` as FindingMessageKey,
    detail,
    message: code,
  }
}

describe('moneybird finding fix types', () => {
  it('maps every code to a FindingCard fix type', () => {
    for (const code of CODES) {
      expect(['oneClick', 'guided', 'explainOnly']).toContain(
        moneybirdFixTypeFor(problem(code, null)),
      )
    }
  })

  it('splits unknown_currency into three fix types', () => {
    expect(
      moneybirdFixTypeFor(
        problem('unknown_currency', 'administration.currency', { currency: '(none)' }),
      ),
    ).toBe('oneClick')
    expect(
      moneybirdFixTypeFor(
        problem('unknown_currency', 'administration.currency', { currency: 'USD' }),
      ),
    ).toBe('explainOnly')
    expect(moneybirdFixTypeFor(problem('unknown_currency', 'sales_invoice:1'))).toBe('guided')
  })

  it('wires unbalanced_document as guided exclude', () => {
    expect(moneybirdFixTypeFor(problem('unbalanced_document', 'sales_invoice:1'))).toBe('guided')
  })

  it('opens period_locked with Niet overzetten primary and Boekjaren secondary', () => {
    const onExcludeDocument = vi.fn()
    const onReviewPeriodLocked = vi.fn()
    const onOpenPeriodSettings = vi.fn()
    const actions = {
      onOpenPeriodSettings,
      onExcludeDocument,
      onReviewPeriodLocked,
      moneybirdHrefFor: () => null,
      labels: {
        exclude: 'Niet overzetten',
        toFiscalYears: 'Naar Boekjaren',
        stepDoNotTransfer: 'Niet overzetten',
        openMoneybird: 'Open in Moneybird',
        mapAccount: '',
        mapTax: 'Btw-tarief koppelen',
        renumberAccount: '',
        renumberContact: '',
        pickType: '',
        confirmEur: '',
        chooseRate: '',
        confirmYearStart: '',
        acknowledgeEmpty: '',
        reread: '',
        deferAttachment: '',
        settings: '',
        drillDown: '',
        stepRate: '',
        stepPreview: '',
        stepConfirm: '',
        stepPermissions: '',
        stepOpenMoneybird: '',
        stepReread: '',
        stepMapAccount: 'Categorie kiezen',
        stepMapTax: 'Btw-code kiezen',
        stepSave: 'Opslaan',
      },
    } as unknown as MoneybirdFindingActions

    const card = moneybirdFindingCard(
      problem('period_locked', 'journal:1', {
        year: '2024',
        reference: 'J-1',
      }),
      'problems',
      actions,
    )
    expect(card.fix.type).toBe('guided')
    if (card.fix.type !== 'guided') return
    expect(card.fix.label).toBe('Niet overzetten')
    expect(card.fix.steps).toEqual(['Niet overzetten', 'Naar Boekjaren'])
    card.fix.onOpen()
    expect(onReviewPeriodLocked).toHaveBeenCalledOnce()
    expect(onExcludeDocument).not.toHaveBeenCalled()
    expect(onOpenPeriodSettings).not.toHaveBeenCalled()
  })

  it('wires tax_code_not_in_force as Opnieuw lezen (no /tax-codes, #96 PM)', () => {
    const onRereadResource = vi.fn()
    const actions = {
      onRereadResource,
      moneybirdHrefFor: () => null,
      labels: {
        reread: 'Opnieuw lezen',
        stepReread: 'Opnieuw lezen',
        mapAccount: '',
        mapTax: '',
        renumberAccount: '',
        renumberContact: '',
        pickType: '',
        confirmEur: '',
        chooseRate: '',
        confirmYearStart: '',
        acknowledgeEmpty: '',
        exclude: '',
        toFiscalYears: '',
        deferAttachment: '',
        openMoneybird: '',
        settings: 'Naar instellingen',
        drillDown: '',
        stepRate: '',
        stepPreview: '',
        stepConfirm: '',
        stepPermissions: '',
        stepOpenMoneybird: '',
        stepDoNotTransfer: '',
        stepMapAccount: '',
        stepMapTax: '',
        stepSave: '',
      },
    } as unknown as MoneybirdFindingActions

    const card = moneybirdFindingCard(
      problem('tax_code_not_in_force', 'salesInvoices.1', {
        reference: '2025-001',
        bookingDate: '2025-06-15',
        taxCode: 'H21',
      }),
      'problems',
      actions,
    )
    expect(card.fix.type).toBe('guided')
    if (card.fix.type !== 'guided') return
    expect(card.fix.label).toBe('Opnieuw lezen')
    expect(card.fix.steps).toEqual(['Opnieuw lezen'])
    card.fix.onOpen()
    expect(onRereadResource).toHaveBeenCalledOnce()
  })

  it('keeps self_assessed_vat_unsupported as explainOnly look-link (no Niet overzetten)', () => {
    const actions = {
      moneybirdHrefFor: () => 'https://moneybird.example/documents/1',
      labels: {
        openMoneybird: 'Open in Moneybird',
        exclude: 'Niet overzetten',
        mapAccount: '',
        mapTax: '',
        renumberAccount: '',
        renumberContact: '',
        pickType: '',
        confirmEur: '',
        chooseRate: '',
        confirmYearStart: '',
        acknowledgeEmpty: '',
        reread: '',
        toFiscalYears: '',
        deferAttachment: '',
        settings: '',
        drillDown: '',
        stepRate: '',
        stepPreview: '',
        stepConfirm: '',
        stepPermissions: '',
        stepOpenMoneybird: '',
        stepReread: '',
        stepDoNotTransfer: '',
        stepMapAccount: '',
        stepMapTax: '',
        stepSave: '',
      },
    } as unknown as MoneybirdFindingActions

    const card = moneybirdFindingCard(
      problem('self_assessed_vat_unsupported', 'purchase_invoices.1', {
        reference: 'LEV-1',
        taxCode: 'VERL-ONTV',
      }),
      'warnings',
      actions,
    )
    expect(card.severity).toBe('warning')
    expect(card.fix.type).toBe('explainOnly')
    if (card.fix.type !== 'explainOnly') return
    expect(card.fix.href).toContain('moneybird.example')
    expect(card.fix.linkLabel).toBe('Open in Moneybird')
  })

  it('gives unmapped_tax_rate guided steps so the To review card is not empty (#90)', () => {
    const onMapTaxRate = vi.fn()
    const actions = {
      onMapTaxRate,
      moneybirdHrefFor: () => null,
      labels: {
        mapTax: 'Btw-tarief koppelen',
        stepMapTax: 'Btw-code kiezen',
        stepSave: 'Opslaan',
        mapAccount: '',
        renumberAccount: '',
        renumberContact: '',
        pickType: '',
        confirmEur: '',
        chooseRate: '',
        confirmYearStart: '',
        acknowledgeEmpty: '',
        reread: '',
        exclude: '',
        toFiscalYears: '',
        deferAttachment: '',
        openMoneybird: '',
        settings: '',
        drillDown: '',
        stepRate: '',
        stepPreview: '',
        stepConfirm: '',
        stepPermissions: '',
        stepOpenMoneybird: '',
        stepReread: '',
        stepDoNotTransfer: '',
        stepMapAccount: 'Categorie kiezen',
      },
    } as unknown as MoneybirdFindingActions

    const card = moneybirdFindingCard(
      problem('unmapped_tax_rate', 'taxRates.90', { name: 'Geen btw', percentage: '—' }),
      'problems',
      actions,
    )
    expect(card.fix.type).toBe('guided')
    if (card.fix.type !== 'guided') return
    expect(card.fix.steps).toEqual(['Btw-code kiezen', 'Opslaan'])
    card.fix.onOpen()
    expect(onMapTaxRate).toHaveBeenCalledOnce()
  })
})

describe('honesty from reconciliation', () => {
  it('never paints unread or empty as reconciled', () => {
    expect(honestyFromReconciliation('unreadable', true)).toBe('unread')
    expect(honestyFromReconciliation('empty', true)).toBe('empty')
    expect(honestyFromReconciliation('read', true)).toBe('reconciled')
    expect(honestyFromReconciliation('read', false)).toBeNull()
  })
})
