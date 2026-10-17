import { describe, expect, it, vi } from 'vitest'
import {
  AMOUNT_DETAIL_KEYS,
  currencyFromDetail,
  currencySymbol,
  detailForDisplay,
  explainOnlyFix,
  formatFindingAmount,
  honestyClasses,
  honestyFromReconciliation,
  oneClickMayApplyImmediately,
  resolveFindingKey,
  severityClasses,
  type FindingFix,
} from '../../src/lib/finding-card.js'
import { findingMessage, findingWhy } from '../../src/i18n/labels.js'
import { translate } from '../../src/i18n/locale.js'
import type { MessageKey } from '../../src/i18n/nl.js'
import { BINDINGS, BINDINGS_BY_ID } from '../../src/lib/keyboard.js'

/**
 * FindingCard contract (#41 Phase 1).
 *
 * Pure helpers rather than a React mount: the props surface and the keyboard
 * rule are what Phase 2 must keep stable, and those are testable by naming
 * keys and shapes the way list-cursor is.
 */

const t = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('nl', key, values)

describe('finding detail amounts', () => {
  it('formats known amount keys with the currency symbol, never as minor units', () => {
    const detail = detailForDisplay({
      debit: '121000',
      credit: '100050',
      year: '2026',
      reference: 'F-1',
    })
    // Glossary / #41: `€ 1.234,56`, nl-NL, never a bare figure or "centen".
    expect(detail['debit']).toBe('€ 1.210,00')
    expect(detail['credit']).toBe('€ 1.000,50')
    expect(detail['year']).toBe('2026')
    expect(detail['debit']).not.toMatch(/cent/i)
    expect(AMOUNT_DETAIL_KEYS.has('debit')).toBe(true)
  })

  it('takes the symbol from the finding currency, including non-EUR', () => {
    // Inbound findings can be USD (e2e fixture); do not hard-code euro.
    const detail = detailForDisplay({
      currency: 'USD',
      declared: '123456',
      fromLines: '100000',
    })
    const usd = currencySymbol('USD')
    expect(detail['declared']).toBe(`${usd} 1.234,56`)
    expect(detail['fromLines']).toBe(`${usd} 1.000,00`)
    expect(detail['declared']).not.toMatch(/^€/)
    expect(currencyFromDetail({ currency: 'USD' })).toBe('USD')
    expect(formatFindingAmount(123456n, 'USD')).toBe(`${usd} 1.234,56`)
  })

  it('leaves non-numeric amount-looking values alone', () => {
    expect(detailForDisplay({ debit: 'n/a' })['debit']).toBe('n/a')
  })
})

describe('severity and honesty chrome', () => {
  it('makes blocking red and warning neutral — never yellow', () => {
    const blocking = severityClasses('blocking')
    const warning = severityClasses('warning')
    expect(blocking.title).toContain('destructive')
    expect(blocking.bar).toContain('destructive')
    expect(blocking.body).toContain('foreground')
    expect(warning.title).not.toContain('destructive')
    expect(warning.bar).not.toContain('destructive')
    expect(JSON.stringify(blocking)).not.toMatch(/primary|yellow|unreconciled/)
    expect(JSON.stringify(warning)).not.toMatch(/primary|yellow|destructive/)
  })

  it('gives unread, empty and reconciled three distinct looks', () => {
    const unread = honestyClasses('unread')
    const empty = honestyClasses('empty')
    const reconciled = honestyClasses('reconciled')
    expect(unread.tone).toBe('muted')
    expect(empty.tone).toBe('neutral')
    expect(reconciled.tone).toBe('good')
    expect(unread.border).not.toBe(empty.border)
    expect(empty.border).not.toBe(reconciled.border)
    expect(unread.border).not.toBe(reconciled.border)
    // Yellow never means honesty either.
    expect(JSON.stringify({ unread, empty, reconciled })).not.toMatch(/primary|yellow/)
  })

  it('maps reconciliation source onto honesty without conflating the three', () => {
    expect(honestyFromReconciliation('unreadable', null)).toBe('unread')
    expect(honestyFromReconciliation('empty', null)).toBe('empty')
    expect(honestyFromReconciliation('read', true)).toBe('reconciled')
    // Unbalanced-but-read is a finding, not an honesty claim.
    expect(honestyFromReconciliation('read', false)).toBeNull()
  })
})

describe('fix types', () => {
  it('treats oneClick without preview as immediately applicable', () => {
    const fix: FindingFix = {
      type: 'oneClick',
      label: 'Map',
      onApply: vi.fn(),
    }
    expect(oneClickMayApplyImmediately(fix)).toBe(true)
  })

  it('refuses to apply a oneClick with preview until confirmed', () => {
    const fix: FindingFix = {
      type: 'oneClick',
      label: 'Map',
      preview: { summary: 'Would write a mapping' },
      onApply: vi.fn(),
    }
    expect(oneClickMayApplyImmediately(fix)).toBe(false)
  })

  it('builds an explainOnly fix with optional link', () => {
    expect(explainOnlyFix()).toEqual({ type: 'explainOnly' })
    expect(explainOnlyFix({ href: '/accounts', linkLabel: 'Chart' })).toEqual({
      type: 'explainOnly',
      href: '/accounts',
      linkLabel: 'Chart',
    })
  })

  it('keeps guided as a distinct variant with onOpen', () => {
    const onOpen = vi.fn()
    const fix: FindingFix = {
      type: 'guided',
      label: 'Guide me',
      onOpen,
      steps: ['Pick a rate', 'Confirm'],
    }
    expect(fix.type).toBe('guided')
    fix.onOpen()
    expect(onOpen).toHaveBeenCalledOnce()
  })
})

describe('finding keyboard', () => {
  const base = { index: 1, count: 3, openFix: null as number | null }

  it('moves with j and k', () => {
    expect(resolveFindingKey('j', base)).toEqual({ action: 'move', index: 2 })
    expect(resolveFindingKey('k', base)).toEqual({ action: 'move', index: 0 })
  })

  it('opens the fix with Enter and closes with Escape', () => {
    expect(resolveFindingKey('Enter', base)).toEqual({ action: 'openFix', index: 1 })
    expect(resolveFindingKey('Escape', { ...base, openFix: 1 })).toEqual({ action: 'closeFix' })
    expect(resolveFindingKey('Escape', base)).toEqual({ action: 'leave' })
  })

  it('ignores modified keys so the palette keeps Cmd+K', () => {
    expect(resolveFindingKey('k', base, true)).toEqual({ action: 'ignore' })
  })

  it('registers the four findings bindings', () => {
    for (const id of ['finding.next', 'finding.previous', 'finding.openFix', 'finding.closeFix']) {
      expect(BINDINGS_BY_ID.get(id)?.group).toBe('keys.group.findings')
    }
    expect(BINDINGS.some((binding) => binding.id === 'finding.next')).toBe(true)
  })
})

describe('finding copy', () => {
  it('renders a moneybird finding in Dutch with euro amounts', () => {
    const text = findingMessage(t, {
      message: 'fallback',
      messageKey: 'moneybird.trial_balance_unbalanced',
      detail: detailForDisplay({ year: '2026', debit: '10000', credit: '9000' }),
    })
    expect(text).toContain('2026')
    expect(text).toContain('€ 100,00')
    expect(text).toContain('€ 90,00')
    expect(text).not.toMatch(/centen|minor units/i)
  })

  it('looks up why-it-matters for moneybird and inbound keys', () => {
    expect(findingWhy(t, 'moneybird.unmapped_account')).toMatch(/mapping/i)
    expect(findingWhy(t, 'inbound.no_invoice_number')).toMatch(/nummer/i)
    expect(findingWhy(t, 'exact.something_unknown')).toBeUndefined()
  })
})
