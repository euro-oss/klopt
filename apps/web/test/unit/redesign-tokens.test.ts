import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Phase 0 redesign tokens (#107): central layer, export defaults, a11y floors.
 */

const here = dirname(fileURLToPath(import.meta.url))
const webSrc = join(here, '..', '..', 'src')

function readWeb(relative: string): string {
  return readFileSync(join(webSrc, relative), 'utf8')
}

function tokenIn(css: string, block: ':root' | '.dark', name: string): string {
  const start = css.search(block === ':root' ? /(?:^|\n):root\s*\{/ : /(?:^|\n)\.dark\s*\{/)
  expect(start, `missing ${block}`).toBeGreaterThanOrEqual(0)
  let depth = 0
  let end = -1
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = css.slice(start, end)
  const match = body.match(
    new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*([^;]+);`),
  )
  expect(match, `${name} in ${block}`).toBeTruthy()
  return match![1]!.replace(/\s+/g, ' ').trim()
}

type Rgb = readonly [number, number, number]

function srgbChannelToLin(c: number): number {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * srgbChannelToLin(rgb[0]) +
    0.7152 * srgbChannelToLin(rgb[1]) +
    0.0722 * srgbChannelToLin(rgb[2])
  )
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const L1 = relativeLuminance(a)
  const L2 = relativeLuminance(b)
  const lighter = Math.max(L1, L2)
  const darker = Math.min(L1, L2)
  return (lighter + 0.05) / (darker + 0.05)
}

function parseHex(value: string): Rgb {
  const m = value.match(/^#([0-9a-f]{6})$/i)
  expect(m, `hex parse: ${value}`).toBeTruthy()
  const n = parseInt(m![1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function resolveColorToken(css: string, block: ':root' | '.dark', name: string): Rgb {
  const seen = new Set<string>()
  const lookup = (n: string, b: ':root' | '.dark'): string => {
    try {
      return tokenIn(css, b, n)
    } catch {
      if (b === '.dark') return tokenIn(css, ':root', n)
      throw new Error(`missing ${n}`)
    }
  }
  const walk = (n: string, b: ':root' | '.dark'): Rgb => {
    const key = `${b}:${n}`
    expect(seen.has(key), `cycle at ${key}`).toBe(false)
    seen.add(key)
    const value = lookup(n, b)
    if (value.startsWith('var(')) {
      const ref = value.match(/^var\((--[a-z0-9-]+)\)$/i)
      expect(ref, `var() parse: ${value}`).toBeTruthy()
      return walk(ref![1]!, b)
    }
    if (value.startsWith('#')) return parseHex(value)
    throw new Error(`unsupported colour form for ${n}: ${value}`)
  }
  return walk(name, block)
}

describe('Phase 0 redesign tokens (#107)', () => {
  const tokens = () => readWeb('styles/tokens.css')
  const app = () => readWeb('styles/app.css')

  it('loads tokens.css from app.css and self-hosts fonts (no Google CDN)', () => {
    const css = app()
    expect(css).toContain("@import './tokens.css'")
    expect(css).toContain("@import '../assets/fonts/fonts.css'")
    expect(css).not.toMatch(/fonts\.googleapis\.com/)
    const fonts = readWeb('assets/fonts/fonts.css')
    expect(fonts).toContain("font-family: 'Inter Variable'")
    expect(fonts).toContain("font-family: 'JetBrains Mono Variable'")
    expect(fonts).not.toContain('Ubuntu Sans')
    expect(readFileSync(join(webSrc, 'assets/fonts/Inter-OFL.txt'), 'utf8')).toContain(
      'SIL Open Font License',
    )
    expect(readFileSync(join(webSrc, 'assets/fonts/JetBrainsMono-OFL.txt'), 'utf8')).toContain(
      'SIL Open Font License',
    )
  })

  it('uses export brand yellow #ffd43b and warm ground', () => {
    const css = tokens()
    expect(tokenIn(css, ':root', '--brand')).toBe('#ffd43b')
    expect(tokenIn(css, ':root', '--ground')).toBe('#f5f5f2')
    expect(tokenIn(css, ':root', '--token-font-sans')).toContain('Inter Variable')
    expect(tokenIn(css, ':root', '--token-font-mono')).toContain('JetBrains Mono Variable')
  })

  it('keeps export radius scale as defaults (swappable via --token-radius-*)', () => {
    const css = tokens()
    expect(tokenIn(css, ':root', '--token-radius-md')).toBe('8px')
    expect(tokenIn(css, ':root', '--token-radius-pill')).toBe('999px')
    expect(css).toContain('--token-shadow-raised')
  })

  it('points --status-attention at export WARN callout (brand-ink / brand-tint)', () => {
    const css = tokens()
    expect(tokenIn(css, ':root', '--status-attention')).toBe('var(--brand-ink)')
    expect(tokenIn(css, ':root', '--status-attention-bg')).toBe('var(--brand-tint)')
    expect(tokenIn(css, ':root', '--brand-ink')).toBe('#8a6a00')
    expect(tokenIn(css, ':root', '--brand-tint')).toBe('#fff6d1')
    expect(tokenIn(css, '.dark', '--brand-ink')).toBe('#f5c518')
    expect(tokenIn(css, '.dark', '--brand-tint')).toBe('#33290a')
    // Red stays destructive / blocking — not attention.
    expect(tokenIn(css, ':root', '--danger')).toBe('#b42318')
    expect(tokenIn(css, ':root', '--status-attention')).not.toBe('var(--danger)')
  })

  it('keeps --warning as the chart token (status-geen-btw stays separate)', () => {
    const css = tokens()
    // Do not lock --status-geen-btw to a specific oklch — PM may retune the orange.
    expect(tokenIn(css, ':root', '--status-geen-btw')).toMatch(/^(oklch|var\()/)
    expect(tokenIn(css, ':root', '--warning')).toBe('#d97706')
    expect(tokenIn(css, '.dark', '--warning')).toBe('#f59e0b')
    expect(tokenIn(css, ':root', '--chart-warning')).toBe('var(--warning)')
  })

  it('keeps tabular figures and maps fonts through tokens', () => {
    const css = app()
    expect(css).toContain('font-variant-numeric: tabular-nums')
    expect(css).toContain('--font-sans: var(--token-font-sans)')
    expect(css).toContain('--font-mono: var(--token-font-mono)')
  })

  it('A: link colour ≥4.5:1 (a11y deviation from yellow-as-text)', () => {
    const css = tokens()
    const lightLink = resolveColorToken(css, ':root', '--link')
    const lightBg = resolveColorToken(css, ':root', '--ground')
    const darkLink = resolveColorToken(css, '.dark', '--link')
    const darkBg = resolveColorToken(css, '.dark', '--ground')
    expect(contrastRatio(lightLink, lightBg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(darkLink, darkBg)).toBeGreaterThanOrEqual(4.5)
    // Ink (not brand yellow) — brand-ink fails 4.5:1 on sunken / status grounds.
    expect(tokenIn(css, ':root', '--link')).toBe('var(--ink)')
  })

  it('B: input border ≥3:1 against ground (a11y deviation from line-control)', () => {
    const css = tokens()
    const lightInput = resolveColorToken(css, ':root', '--input')
    const lightGround = resolveColorToken(css, ':root', '--ground')
    const darkInput = resolveColorToken(css, '.dark', '--input')
    const darkGround = resolveColorToken(css, '.dark', '--ground')
    expect(contrastRatio(lightInput, lightGround)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(darkInput, darkGround)).toBeGreaterThanOrEqual(3)
    expect(tokenIn(css, ':root', '--line-control')).toBe('#c9c8c1')
    expect(tokenIn(css, ':root', '--input-border')).toBe('#8a8980')
  })

  it('C: focus ring ≥3:1 against background', () => {
    const css = tokens()
    const lightRing = resolveColorToken(css, ':root', '--ring')
    const lightBg = resolveColorToken(css, ':root', '--background')
    const darkRing = resolveColorToken(css, '.dark', '--ring')
    const darkBg = resolveColorToken(css, '.dark', '--background')
    expect(contrastRatio(lightRing, lightBg)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(darkRing, darkBg)).toBeGreaterThanOrEqual(3)
  })

  it('exposes 44px touch control token and uses it on field-control', () => {
    expect(tokenIn(tokens(), ':root', '--control-h-touch')).toBe('44px')
    expect(app()).toContain('min-height: var(--control-h-touch)')
  })

  it('turns primitive motion off under prefers-reduced-motion', () => {
    const css = app()
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(readWeb('components/ui/sheet.tsx')).toContain('motion-reduce:transition-none')
    expect(readWeb('components/ui/button.tsx')).toContain('motion-reduce:transition-none')
  })

  it('uses solid offset outline for focus — and never outline-none', () => {
    for (const file of [
      'components/ui/button.tsx',
      'components/ui/input.tsx',
      'components/ui/badge.tsx',
    ]) {
      const source = readWeb(file)
      expect(source, file).not.toMatch(/['"`][^'"`]*\boutline-none\b[^'"`]*['"`]/)
      expect(source).toContain('focus-visible:outline-solid')
      expect(source).toContain('focus-visible:outline-2')
      expect(source).toContain('focus-visible:outline-ring')
    }
    expect(app()).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ring\)/)
  })

  it('exposes success, info and attention variants on badge, button and alert', () => {
    for (const file of [
      'components/ui/badge.tsx',
      'components/ui/button.tsx',
      'components/ui/alert.tsx',
    ]) {
      const source = readWeb(file)
      expect(source).toContain('success:')
      expect(source).toContain('info:')
      expect(source).toContain('attention:')
      expect(source).toContain('destructive:')
    }
  })
})
