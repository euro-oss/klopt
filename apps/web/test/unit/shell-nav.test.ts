import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REPORTS_TABS,
  SHELL_NAV,
  isNavActive,
  pageTitleKey,
  paletteNavItems,
  sidebarFooterItems,
  sidebarPrimaryItems,
  visibleReportsTabs,
} from '../../src/lib/shell-nav.js'

/**
 * Flat shell nav (#107 Phase 0): eight primaries, footer, palette-only rows.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
const shell = readFileSync(join(root, 'components', 'app-shell.tsx'), 'utf8')
const palette = readFileSync(join(root, 'components', 'command-palette.tsx'), 'utf8')

describe('shell-nav Phase 0', () => {
  it('exposes eight primary destinations in export order', () => {
    const primary = sidebarPrimaryItems('owner', false).map((item) => item.to)
    expect(primary).toEqual([
      '/',
      '/inbox',
      '/invoices',
      '/purchases',
      '/bank/match',
      '/vat',
      '/reports/profit-and-loss',
      '/contacts',
    ])
  })

  it('pins Settings and Shortcuts in the footer', () => {
    const footer = sidebarFooterItems('owner', false)
    expect(footer.map((item) => item.key)).toEqual(['nav.settings', 'nav.shortcuts'])
    expect(footer.some((item) => item.openShortcuts === true)).toBe(true)
  })

  it('keeps Journaalposten and Proefbalans out of the rail, in ⌘K when advanced', () => {
    const rail = sidebarPrimaryItems('owner', true)
    expect(rail.some((item) => item.to === '/entries')).toBe(false)
    expect(rail.some((item) => item.to === '/reports/trial-balance')).toBe(false)

    const off = paletteNavItems('owner', false).map(({ item }) => item.to)
    expect(off).toContain('/entries')
    expect(off).toContain('/reports/trial-balance')

    const on = paletteNavItems('owner', true).map(({ item }) => item.binding)
    expect(on).toContain('go.journal')
    expect(on).toContain('go.trial')
  })

  it('keeps Importeren as a palette action (and Settings hub row elsewhere)', () => {
    expect(SHELL_NAV.some((item) => item.binding === 'go.import' && item.placement === 'palette')).toBe(
      true,
    )
    expect(sidebarPrimaryItems('owner', true).some((item) => item.to === '/importeren')).toBe(false)
  })

  it('orders Reports tabs with Geavanceerd gates on 5 and 6', () => {
    expect(REPORTS_TABS.map((tab) => tab.id)).toEqual([
      'profit',
      'balance',
      'debtors',
      'creditors',
      'trial',
      'journal',
    ])
    expect(visibleReportsTabs(false).map((tab) => tab.digit)).toEqual([1, 2, 3, 4])
    expect(visibleReportsTabs(true).map((tab) => tab.digit)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('lights Reports for /entries and /reports/*', () => {
    expect(
      isNavActive('/entries', '/reports/profit-and-loss', undefined, undefined, [
        '/reports',
        '/entries',
      ]),
    ).toBe(true)
    expect(
      isNavActive('/reports/trial-balance', '/reports/profit-and-loss', undefined, undefined, [
        '/reports',
        '/entries',
      ]),
    ).toBe(true)
  })

  it('switches phone/desktop chrome with CSS, not usePhoneViewport', () => {
    expect(shell).toContain('hidden md:flex')
    expect(shell).toContain('md:hidden')
    expect(shell).not.toContain('usePhoneViewport')
  })

  it('help Ga naar shares paletteNavItems; Shortcuts opens help', () => {
    expect(palette).toContain('function helpGoToRows')
    expect(palette).toContain('klopt:open-help')
    expect(shell).toContain('klopt:open-help')
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
