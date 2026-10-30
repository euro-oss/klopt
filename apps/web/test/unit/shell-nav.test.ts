import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  JOURNAL_TABS,
  REPORTS_TABS,
  SHELL_NAV,
  isNavActive,
  pageTitleKey,
  paletteNavItems,
  sidebarFooterItems,
  sidebarPrimaryItems,
  sidebarPrimarySections,
  visibleJournalTabs,
  visibleReportsTabs,
} from '../../src/lib/shell-nav.js'

/**
 * v2 grouped shell nav (#107 Phase 0).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
const shell = readFileSync(join(root, 'components', 'app-shell.tsx'), 'utf8')
const palette = readFileSync(join(root, 'components', 'command-palette.tsx'), 'utf8')

describe('shell-nav Phase 0 (v2 IA)', () => {
  it('exposes v2 primary destinations: Home, Inbox, Money, Books', () => {
    const primary = sidebarPrimaryItems('owner', false).map((item) => item.to)
    expect(primary).toEqual([
      '/',
      '/inbox',
      '/invoices',
      '/purchases',
      '/bank/match',
      '/contacts',
      '/entries',
      '/vat',
      '/reports/profit-and-loss',
    ])
  })

  it('groups Money and Books with section labels', () => {
    const sections = sidebarPrimarySections('owner', false)
    expect(sections.map((s) => s.key)).toEqual([undefined, 'nav.group.money', 'nav.group.books'])
    expect(sections[1]!.items.map((i) => i.key)).toEqual([
      'nav.sales',
      'nav.costs',
      'nav.bank',
      'nav.contacts',
    ])
    expect(sections[2]!.items.map((i) => i.key)).toEqual(['nav.journal', 'nav.vat', 'nav.reports'])
  })

  it('pins Import, Settings and Shortcuts in the footer', () => {
    const footer = sidebarFooterItems('owner', false)
    expect(footer.map((item) => item.key)).toEqual(['nav.import', 'nav.settings', 'nav.shortcuts'])
    expect(footer.some((item) => item.openShortcuts === true)).toBe(true)
  })

  it('keeps Journal and Proefbalans reachable without Geavanceerd', () => {
    const rail = sidebarPrimaryItems('owner', false)
    expect(rail.some((item) => item.to === '/entries')).toBe(true)
    expect(rail.some((item) => item.binding === 'go.journal')).toBe(true)

    expect(visibleReportsTabs().map((tab) => tab.id)).toEqual([
      'profit',
      'balance',
      'debtors',
      'creditors',
      'trial',
    ])
    expect(visibleReportsTabs(false).map((tab) => tab.digit)).toEqual([1, 2, 3, 4, 5])
  })

  it('orders Journal SubNav: Entries + Trial only (Ledger is [API], omitted)', () => {
    expect(JOURNAL_TABS.map((tab) => tab.id)).toEqual(['entries', 'trial'])
    expect(visibleJournalTabs().map((tab) => tab.to)).toEqual([
      '/entries',
      '/reports/trial-balance',
    ])
    expect(JOURNAL_TABS.some((tab) => tab.id === 'ledger')).toBe(false)
  })

  it('hides categories ([API]) from rail and palette', () => {
    expect(SHELL_NAV.some((item) => item.to === '/accounts')).toBe(false)
    const bindings = paletteNavItems('owner', true).map(({ item }) => item.to)
    expect(bindings).not.toContain('/accounts')
  })

  it('keeps Importeren in the footer (not palette-only)', () => {
    expect(
      SHELL_NAV.some((item) => item.binding === 'go.import' && item.placement === 'footer'),
    ).toBe(true)
    expect(sidebarFooterItems('owner', true).some((item) => item.to === '/importeren')).toBe(true)
  })

  it('orders Reports tabs with Proefbalans as 5 (no Journaalposten tab)', () => {
    expect(REPORTS_TABS.map((tab) => tab.id)).toEqual([
      'profit',
      'balance',
      'debtors',
      'creditors',
      'trial',
    ])
  })

  it('lights Journal for /entries; Reports for /reports/* (incl. trial)', () => {
    expect(isNavActive('/entries', '/entries')).toBe(true)
    expect(isNavActive('/reports/trial-balance', '/entries')).toBe(false)
    expect(
      isNavActive('/reports/trial-balance', '/reports/profit-and-loss', undefined, undefined, [
        '/reports',
      ]),
    ).toBe(true)
  })

  it('switches phone/desktop chrome with CSS, not usePhoneViewport', () => {
    expect(shell).toContain('hidden md:flex')
    expect(shell).toContain('md:hidden')
    expect(shell).toContain('PhoneTabBar')
    expect(shell).not.toContain('usePhoneViewport')
  })

  it('help Ga naar shares paletteNavItems; Shortcuts opens help', () => {
    expect(palette).toContain('function helpGoToRows')
    expect(palette).toContain('klopt:open-help')
    expect(shell).toContain('klopt:open-help')
  })

  it('palette still reaches trial and journal bindings', () => {
    const bindings = paletteNavItems('owner', false).map(({ item }) => item.binding)
    expect(bindings).toContain('go.journal')
    expect(bindings).toContain('go.trial')
    expect(bindings).toContain('go.import')
  })
})

describe('isNavActive with ?bron=', () => {
  const moneybird = { bron: 'moneybird' } as const
  const exact = { bron: 'exact' } as const

  it('activates only Moneybird when bron is moneybird', () => {
    expect(isNavActive('/importeren', '/importeren', { bron: 'moneybird' }, moneybird)).toBe(true)
    expect(isNavActive('/importeren', '/importeren', { bron: 'moneybird' }, exact)).toBe(false)
  })

  it('activates only Exact when bron is exact', () => {
    expect(isNavActive('/importeren', '/importeren', { bron: 'exact' }, exact)).toBe(true)
    expect(isNavActive('/importeren', '/importeren', { bron: 'exact' }, moneybird)).toBe(false)
  })

  it('defaults missing bron to Moneybird only', () => {
    expect(isNavActive('/importeren', '/importeren', {}, moneybird)).toBe(true)
    expect(isNavActive('/importeren', '/importeren', {}, exact)).toBe(false)
  })

  it('pageTitleKey picks Moneybird vs Exact from bron', () => {
    expect(pageTitleKey('/importeren', false, { bron: 'moneybird' })).toBe('nav.importMoneybird')
    expect(pageTitleKey('/importeren', false, { bron: 'exact' })).toBe('nav.importExact')
  })
})
