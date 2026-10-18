import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Redesign slice 1 (#61): tokens + primitive variants, held to the source.
 *
 * Ports `prototypes/redesign/src/tokens.css` into `app.css`. Primary is ink;
 * yellow stays accent/highlight only; status hues and line tokens land here.
 * Contrast floors (PM #63): focus ring ≥3:1, attention text ≥4.5:1, dark
 * input border ≥3:1.
 */

const here = dirname(fileURLToPath(import.meta.url))
const webSrc = join(here, '..', '..', 'src')
const repoRoot = join(here, '..', '..', '..', '..')

function readWeb(relative: string): string {
  return readFileSync(join(webSrc, relative), 'utf8')
}

function readRepo(relative: string): string {
  return readFileSync(join(repoRoot, relative), 'utf8')
}

/** Extract a custom property from a CSS block (`:root` or `.dark`). */
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
  // Collapse Prettier line-breaks so app.css and tokens.css compare equal.
  return match![1]!.replace(/\s+/g, ' ').trim()
}

// --- WCAG contrast (sRGB relative luminance) ---------------------------------

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

/** Björn Ottosson OKLCH → sRGB (0–255), matching Chromium for our token set. */
function oklchToSrgb(L: number, C: number, h: number): Rgb {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const to8 = (c: number): number => {
    const x = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055
    return Math.min(255, Math.max(0, Math.round(x * 255)))
  }
  return [to8(r), to8(g), to8(bl)]
}

function parseOklch(value: string): Rgb {
  const m = value.match(/oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\)/)
  expect(m, `oklch parse: ${value}`).toBeTruthy()
  return oklchToSrgb(+m![1]!, +m![2]!, +m![3]!)
}

function parseHex(value: string): Rgb {
  const m = value.match(/^#([0-9a-f]{6})$/i)
  expect(m, `hex parse: ${value}`).toBeTruthy()
  const n = parseInt(m![1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * `color-mix(in oklab, var(--white|black) p%, var(--white|black))` — achromatic
 * oklab mix, then OKLab → sRGB. Matches Chromium for our line-strong tokens.
 */
function resolveColorMixAchromatic(value: string, resolveName: (name: string) => Rgb): Rgb {
  const m = value.match(
    /color-mix\(\s*in oklab,\s*var\(--(white|black)\)\s+(\d+(?:\.\d+)?)%,\s*var\(--(white|black)\)\s*\)/,
  )
  expect(m, `color-mix parse: ${value}`).toBeTruthy()
  const from = resolveName(`--${m![1]!}`)
  const pct = +m![2]! / 100
  const to = resolveName(`--${m![3]!}`)
  // Achromatic: mix OKLab L (≈ relative for white/black endpoints).
  const Lfrom = relativeLuminance(from) > 0.5 ? 1 : 0
  const Lto = relativeLuminance(to) > 0.5 ? 1 : 0
  const L = Lfrom * pct + Lto * (1 - pct)
  const lin = L * L * L
  const to8 = (c: number): number => {
    const x = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    return Math.min(255, Math.max(0, Math.round(x * 255)))
  }
  const ch = to8(lin)
  return [ch, ch, ch]
}

/**
 * Resolve a custom property in `:root` or `.dark` to an sRGB triple, following
 * `var(--…)` chains and the literal forms used in app.css / tokens.css.
 */
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
    let value = lookup(n, b)
    if (value.startsWith('var(')) {
      const ref = value.match(/^var\((--[a-z0-9-]+)\)$/i)
      expect(ref, `var() parse: ${value}`).toBeTruthy()
      return walk(ref![1]!, b)
    }
    if (value.startsWith('#')) return parseHex(value)
    if (value.startsWith('oklch(')) return parseOklch(value)
    if (value.startsWith('color-mix(')) {
      return resolveColorMixAchromatic(value, (inner) => walk(inner, b))
    }
    throw new Error(`unsupported colour form for ${n}: ${value}`)
  }
  return walk(name, block)
}

function mixTint(fg: Rgb, bg: Rgb, amount: number): Rgb {
  // Approximate the badge/alert `/8` fill: color-mix(in oklab, hue 8%, bg).
  // For WCAG of text-on-tint this is within ~0.02 of Chromium for our hues.
  const t = amount
  return [
    Math.round(fg[0] * t + bg[0] * (1 - t)),
    Math.round(fg[1] * t + bg[1] * (1 - t)),
    Math.round(fg[2] * t + bg[2] * (1 - t)),
  ]
}

describe('Redesign tokens and primitives (slice 1)', () => {
  it('keeps app.css :root/.dark in sync with prototypes/redesign/src/tokens.css', () => {
    const app = readWeb('styles/app.css')
    const proto = readRepo('prototypes/redesign/src/tokens.css')
    for (const name of [
      '--primary',
      '--accent',
      '--status-attention',
      '--status-success',
      '--status-info',
      '--line-strong',
      '--input',
      '--ring',
      '--success',
      '--warning',
      '--info',
    ] as const) {
      expect(tokenIn(app, ':root', name)).toBe(tokenIn(proto, ':root', name))
      // .dark may omit tokens that inherit from :root; only compare when both set.
      const appDark = (() => {
        try {
          return tokenIn(app, '.dark', name)
        } catch {
          return null
        }
      })()
      const protoDark = (() => {
        try {
          return tokenIn(proto, '.dark', name)
        } catch {
          return null
        }
      })()
      if (appDark !== null && protoDark !== null) {
        expect(appDark, `.dark ${name}`).toBe(protoDark)
      }
    }
  })

  it('makes --primary ink in light and dark, yellow only as --accent', () => {
    const css = readWeb('styles/app.css')
    expect(tokenIn(css, ':root', '--primary')).toBe('var(--black)')
    expect(tokenIn(css, '.dark', '--primary')).toBe('var(--white)')
    expect(tokenIn(css, ':root', '--accent')).toBe('var(--yellow)')
  })

  it('pins attention L=0.53 and dark line-strong at 48% white', () => {
    const app = readWeb('styles/app.css')
    const proto = readRepo('prototypes/redesign/src/tokens.css')
    for (const css of [app, proto]) {
      expect(tokenIn(css, ':root', '--status-attention')).toBe('oklch(0.53 0.14 55)')
      expect(tokenIn(css, '.dark', '--line-strong')).toBe(
        'color-mix(in oklab, var(--white) 48%, var(--black))',
      )
      expect(tokenIn(css, ':root', '--input')).toBe('var(--line-strong)')
    }
  })

  it('keeps square radius, Ubuntu Sans, and tabular figures', () => {
    const css = readWeb('styles/app.css')
    expect(css).toContain('--radius: 0rem')
    expect(css).toContain("'Ubuntu Sans Variable'")
    expect(css).toContain('font-variant-numeric: tabular-nums')
  })

  it('turns primitive motion off under prefers-reduced-motion', () => {
    const css = readWeb('styles/app.css')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(readWeb('components/ui/sheet.tsx')).toContain('motion-reduce:transition-none')
    expect(readWeb('components/ui/popover.tsx')).toContain('motion-reduce:transition-none')
    expect(readWeb('components/ui/button.tsx')).toContain('motion-reduce:transition-none')
  })

  it('uses solid offset outline for focus — and never outline-none', () => {
    for (const file of [
      'components/ui/button.tsx',
      'components/ui/input.tsx',
      'components/ui/badge.tsx',
    ]) {
      const source = readWeb(file)
      // Tailwind 4: outline-none sets --tw-outline-style:none; outline-2 then
      // paints width 2px with style none — invisible. See e2e/focus-outline.spec.ts.
      // Only the class string — comments may mention the trap by name.
      expect(source, file).not.toMatch(/['"`][^'"`]*\boutline-none\b[^'"`]*['"`]/)
      expect(source).toContain('focus-visible:outline-solid')
      expect(source).toContain('focus-visible:outline-2')
      expect(source).toContain('focus-visible:outline-ring')
    }

    const button = readWeb('components/ui/button.tsx')
    expect(button).toContain('focus-visible:outline-offset-2')
    expect(button).not.toContain('focus-visible:ring-ring/30')
    expect(button).not.toMatch(/focus-visible:border-(destructive|success|info|warning)/)

    const input = readWeb('components/ui/input.tsx')
    expect(input).toContain('focus-visible:outline-offset-0')
    expect(input).toContain('aria-invalid:border-destructive')
    expect(input).toContain('aria-invalid:outline-destructive')

    const badge = readWeb('components/ui/badge.tsx')
    expect(badge).toContain('focus-visible:outline-offset-2')

    const app = readWeb('styles/app.css')
    expect(app).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ring\)/)
  })

  it('A: --ring vs background ≥3:1 from parsed app.css tokens', () => {
    const app = readWeb('styles/app.css')
    // Resolve through the real token chain (e.g. --ring → var(--black) → #000).
    const lightRing = resolveColorToken(app, ':root', '--ring')
    const lightBg = resolveColorToken(app, ':root', '--background')
    const lightPrimary = resolveColorToken(app, ':root', '--primary')
    const darkRing = resolveColorToken(app, '.dark', '--ring')
    const darkBg = resolveColorToken(app, '.dark', '--background')
    const darkPrimary = resolveColorToken(app, '.dark', '--primary')

    const lightRingVsBg = contrastRatio(lightRing, lightBg)
    const darkRingVsBg = contrastRatio(darkRing, darkBg)
    expect(lightRingVsBg).toBeGreaterThanOrEqual(3)
    expect(darkRingVsBg).toBeGreaterThanOrEqual(3)

    // Token-pair ring vs primary stays low by design; outline-offset paints on
    // the page (covered by ring-vs-background + e2e/focus-outline.spec.ts).
    const lightRingVsPrimary = contrastRatio(lightRing, lightPrimary)
    const darkRingVsPrimary = contrastRatio(darkRing, darkPrimary)
    expect(lightRingVsPrimary).toBeLessThan(3)
    expect(darkRingVsPrimary).toBeLessThan(3)
  })

  it('B: attention text on /8 tint ≥4.5:1 in light and dark (parsed tokens)', () => {
    const app = readWeb('styles/app.css')
    const lightAtt = resolveColorToken(app, ':root', '--status-attention')
    const darkAtt = resolveColorToken(app, '.dark', '--status-attention')
    const lightBg = resolveColorToken(app, ':root', '--background')
    const darkBg = resolveColorToken(app, '.dark', '--background')
    const lightOnTint = contrastRatio(lightAtt, mixTint(lightAtt, lightBg, 0.08))
    const darkOnTint = contrastRatio(darkAtt, mixTint(darkAtt, darkBg, 0.08))
    expect(lightOnTint).toBeGreaterThanOrEqual(4.5)
    expect(darkOnTint).toBeGreaterThanOrEqual(4.5)
  })

  it('C: dark --line-strong (input border) ≥3:1 against page background; Input uses it', () => {
    const app = readWeb('styles/app.css')
    const lineStrong = resolveColorToken(app, '.dark', '--line-strong')
    const darkBg = resolveColorToken(app, '.dark', '--background')
    expect(contrastRatio(lineStrong, darkBg)).toBeGreaterThanOrEqual(3)
    expect(tokenIn(app, ':root', '--input')).toBe('var(--line-strong)')
    expect(readWeb('components/ui/input.tsx')).toContain('field-control')
    expect(readWeb('styles/app.css')).toContain('border: 1px solid var(--color-input)')
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

  it('ships status badges as text-xs font-medium normal-case tracking-normal', () => {
    const badge = readWeb('components/ui/badge.tsx')
    for (const variant of ['destructive:', 'success:', 'info:', 'attention:']) {
      const idx = badge.indexOf(variant)
      expect(idx).toBeGreaterThan(-1)
      const slice = badge.slice(idx, idx + 220)
      expect(slice).toContain('text-xs')
      expect(slice).toContain('font-medium')
      expect(slice).toContain('normal-case')
      expect(slice).toContain('tracking-normal')
    }
  })

  it('sizes default/icon buttons to 44px mobile / 36px desktop', () => {
    const button = readWeb('components/ui/button.tsx')
    expect(button).toContain("'h-11 gap-1.5 px-6 md:h-9")
    expect(button).toContain("icon: 'size-11 md:size-9'")
  })

  it('uses yellow accent for the fiscal-years Current pill', () => {
    const fiscal = readWeb('routes/_app/fiscal-years.tsx')
    expect(fiscal).toContain('bg-accent text-accent-foreground')
    expect(fiscal).not.toContain('bg-primary/15')
  })
})
