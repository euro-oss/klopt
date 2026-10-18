import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Shared shell nav (#64): CSS dual chrome, palette order, Geavanceerd deferral.
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
