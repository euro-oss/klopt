import { describe, expect, it } from 'vitest'
import type { FindingMessageKey, MoneybirdProblem } from '@klopt/core'
import { moneybirdFixTypeFor } from '../../src/lib/moneybird-findings.js'
import { honestyFromReconciliation } from '../../src/lib/finding-card.js'

const CODES = [
  'unmapped_account',
  'unmapped_tax_rate',
  'incompatible_tax_rate',
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
})

describe('honesty from reconciliation', () => {
  it('never paints unread or empty as reconciled', () => {
    expect(honestyFromReconciliation('unreadable', true)).toBe('unread')
    expect(honestyFromReconciliation('empty', true)).toBe('empty')
    expect(honestyFromReconciliation('read', true)).toBe('reconciled')
    expect(honestyFromReconciliation('read', false)).toBeNull()
  })
})
