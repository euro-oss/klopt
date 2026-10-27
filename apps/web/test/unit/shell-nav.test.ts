import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isNavActive, pageTitleKey } from '../../src/lib/shell-nav.js'

/**
 * Shared shell nav (#64): CSS dual chrome, palette order, Geavanceerd deferral.
 * Also asserts Moneybird vs Exact `?bron=` active state (import wizard).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
const nav = readFileSync(join(root, 'lib', 'shell-nav.ts'), 'utf8')
const shell = readFileSync(join(root, 'components', 'app-shell.tsx'), 'utf8')
const palette = readFileSync(join(root, 'components', 'command-palette.tsx'), 'utf8')
const keycap = readFileSync(join(root, 'components', 'ui', 'keycap.tsx'), 'utf8')
const sheet = readFileSync(join(root, 'components', 'ui', 'sheet.tsx'), 'utf8')

describe('shell-nav', () => {
  it('defers Journaalposten and Proefbalans when Geavanceerd is off', () => {
    expect(nav).toContain("to: '/entries'")
    expect(nav).toContain('advancedOnly: true')
    expect(nav).toContain("to: '/reports/trial-balance'")
    expect(nav).toContain('function paletteNavItems')
    // Deferred branch appends advanced-only after the primary list.
    expect(nav).toContain('[...primary, ...deferred]')
  })

  it('switches phone/desktop chrome with CSS, not usePhoneViewport', () => {
    expect(shell).toContain('hidden md:flex')
    expect(shell).toContain('md:hidden')
    expect(shell).not.toContain('usePhoneViewport')
    expect(shell).not.toContain('useSyncExternalStore(\n    subscribePhoneViewport')
  })

  it('help Ga naar shares paletteNavItems; keycaps and Sheet close match review', () => {
    expect(palette).toContain('function helpGoToRows')
    expect(palette).toContain('helpGoToRows(role, advanced)')
    expect(palette).toContain('focus:outline-hidden')
    expect(keycap).toContain('font-sans')
    expect(sheet).toContain('top-0.5 right-1')
    expect(sheet).toContain('size-[18px]')
    expect(shell).toContain('<Keycap>K</Keycap>')
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
    expect(isNavActive('/importeren', '/importeren', undefined, moneybird)).toBe(true)
    expect(isNavActive('/importeren', '/importeren', undefined, exact)).toBe(false)
  })

  it('reads bron from URLSearchParams', () => {
    expect(
      isNavActive('/importeren', '/importeren', new URLSearchParams('bron=exact'), exact),
    ).toBe(true)
    expect(
      isNavActive('/importeren', '/importeren', new URLSearchParams('bron=exact'), moneybird),
    ).toBe(false)
  })

  it('pageTitleKey picks Moneybird vs Exact from bron', () => {
    expect(pageTitleKey('/importeren', false, { bron: 'moneybird' })).toBe('nav.importMoneybird')
    expect(pageTitleKey('/importeren', false, { bron: 'exact' })).toBe('nav.importExact')
    expect(pageTitleKey('/importeren', false, {})).toBe('nav.importMoneybird')
  })
})
