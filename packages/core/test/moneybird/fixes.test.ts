import { describe, expect, it } from 'vitest'
import {
  MONEYBIRD_PROBLEM_CODES,
  fixForUnknownCurrency,
  fixSpecFor,
  fixSpecForProblem,
  honestyForFinding,
  mayClaimReconciled,
  unknownCurrencyVariantOf,
  type MoneybirdProblem,
  type MoneybirdProblemCode,
} from '../../src/index.js'

function problem(
  code: MoneybirdProblemCode,
  path: string | null,
  detail: Record<string, string> = {},
): MoneybirdProblem {
  return {
    code,
    path,
    messageKey: `moneybird.${code}`,
    detail,
    message: code,
  }
}

describe('every MoneybirdProblemCode has a fix', () => {
  it('covers all 20 codes', () => {
    expect(MONEYBIRD_PROBLEM_CODES).toHaveLength(20)
    for (const code of MONEYBIRD_PROBLEM_CODES) {
      expect(fixSpecFor(code).code).toBe(code)
      expect(['oneClick', 'guided', 'explainOnly']).toContain(fixSpecFor(code).fixType)
    }
  })

  it.each([
    ['unmapped_account', 'guided'],
    ['unmapped_tax_rate', 'guided'],
    ['incompatible_tax_rate', 'guided'],
    ['null_percentage_vat_mismatch', 'explainOnly'],
    ['trial_balance_account_missing', 'guided'],
    ['account_number_collision', 'guided'],
    ['contact_number_collision', 'oneClick'],
    ['derived_account_type', 'guided'],
    ['fiscal_year_start_unknown', 'oneClick'],
    ['fiscal_year_start_mismatch', 'explainOnly'],
    ['resource_unreadable', 'guided'],
    ['trial_balance_empty', 'oneClick'],
    ['trial_balance_unbalanced', 'guided'],
    ['period_locked', 'guided'],
    ['unbalanced_document', 'guided'],
    ['attachment_without_url', 'oneClick'],
    ['draft_skipped', 'explainOnly'],
  ] as const)('%s → %s', (code, fixType) => {
    expect(fixSpecFor(code).fixType).toBe(fixType)
  })
})

describe('unknown_currency variants', () => {
  it('treats a missing administration currency as one-click EUR', () => {
    const finding = problem('unknown_currency', 'administration.currency', {
      currency: '(none)',
      functionalCurrency: 'EUR',
    })
    expect(unknownCurrencyVariantOf(finding)).toBe('missing')
    expect(fixSpecForProblem(finding)).toMatchObject({
      fixType: 'oneClick',
      changesBooks: false,
    })
  })

  it('treats an administration currency mismatch as explain-only', () => {
    const finding = problem('unknown_currency', 'administration.currency', {
      currency: 'USD',
      functionalCurrency: 'EUR',
    })
    expect(unknownCurrencyVariantOf(finding)).toBe('administration')
    expect(fixForUnknownCurrency('administration').fixType).toBe('explainOnly')
  })

  it('treats a per-document currency as the guided Koers step', () => {
    const finding = problem('unknown_currency', 'sales_invoice:1', {
      currency: 'USD',
      functionalCurrency: 'EUR',
    })
    expect(unknownCurrencyVariantOf(finding)).toBe('document')
    expect(fixSpecForProblem(finding)).toMatchObject({
      fixType: 'guided',
      changesBooks: true,
    })
  })
})

describe('honesty guards', () => {
  it('never lets unread or empty count as reconciled', () => {
    expect(mayClaimReconciled('unreadable', true)).toBe(false)
    expect(mayClaimReconciled('unreadable', null)).toBe(false)
    expect(mayClaimReconciled('empty', true)).toBe(false)
    expect(mayClaimReconciled('empty', null)).toBe(false)
    expect(mayClaimReconciled('read', true)).toBe(true)
    expect(mayClaimReconciled('read', false)).toBe(false)
  })

  it('marks resource_unreadable as unread and trial_balance_empty as empty', () => {
    expect(honestyForFinding('resource_unreadable')).toBe('unread')
    expect(honestyForFinding('trial_balance_empty')).toBe('empty')
    expect(honestyForFinding('unmapped_account')).toBeNull()
  })
})
