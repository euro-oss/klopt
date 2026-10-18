import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Redesign slice 1 (#61): tokens + primitive variants, held to the source.
 *
 * Ports `prototypes/redesign/src/tokens.css` into `app.css`. Primary is ink;
 * yellow stays accent/highlight only; status hues and line tokens land here.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')

function read(relative: string): string {
  return readFileSync(join(root, relative), 'utf8')
}

describe('Redesign tokens and primitives (slice 1)', () => {
  it('makes --primary ink in light and dark, yellow only as --accent', () => {
    const css = read('styles/app.css')
    expect(css).toMatch(/:root\s*\{[\s\S]*?--primary:\s*var\(--black\)/)
    expect(css).toMatch(/\.dark\s*\{[\s\S]*?--primary:\s*var\(--white\)/)
    expect(css).toMatch(/:root\s*\{[\s\S]*?--accent:\s*var\(--yellow\)/)
    expect(css).not.toMatch(/:root\s*\{[\s\S]*?--primary:\s*var\(--yellow\)/)
  })

  it('adds status success/info, orange-leaning attention, and line-strong', () => {
    const css = read('styles/app.css')
    expect(css).toContain('--status-success:')
    expect(css).toContain('--status-info:')
    expect(css).toContain('--status-attention: oklch(0.56 0.14 55)')
    expect(css).toContain('--line-strong:')
    expect(css).toContain('--success: var(--status-success)')
    expect(css).toContain('--warning: var(--status-attention)')
    expect(css).toContain('--info: var(--status-info)')
    expect(css).toContain('--input: var(--line-strong)')
    expect(css).toContain('--color-success: var(--success)')
    expect(css).toContain('--color-warning: var(--warning)')
    expect(css).toContain('--color-info: var(--info)')
  })

  it('keeps square radius, Ubuntu Sans, and tabular figures', () => {
    const css = read('styles/app.css')
    expect(css).toContain('--radius: 0rem')
    expect(css).toContain("'Ubuntu Sans Variable'")
    expect(css).toContain('font-variant-numeric: tabular-nums')
  })

  it('turns primitive motion off under prefers-reduced-motion', () => {
    const css = read('styles/app.css')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(read('components/ui/sheet.tsx')).toContain('motion-reduce:transition-none')
    expect(read('components/ui/popover.tsx')).toContain('motion-reduce:transition-none')
    expect(read('components/ui/button.tsx')).toContain('motion-reduce:transition-none')
  })

  it('exposes success, info and attention variants on badge, button and alert', () => {
    for (const file of [
      'components/ui/badge.tsx',
      'components/ui/button.tsx',
      'components/ui/alert.tsx',
    ]) {
      const source = read(file)
      expect(source).toContain('success:')
      expect(source).toContain('info:')
      expect(source).toContain('attention:')
      expect(source).toContain('destructive:')
    }
  })

  it('ships Input on field-control / --input rather than an underline', () => {
    const input = read('components/ui/input.tsx')
    expect(input).toContain('field-control')
    expect(input).not.toContain('border-b-input')
  })
})
