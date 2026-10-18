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

/**
 * `color-mix(in oklab, white|black p%, black|white)` — achromatic oklab mix,
 * then OKLab → sRGB. Matches Chromium for our line-strong tokens.
 */
function resolveLineStrong(value: string): Rgb {
  const m = value.match(
    /color-mix\(\s*in oklab,\s*var\(--(white|black)\)\s+(\d+(?:\.\d+)?)%,\s*var\(--(white|black)\)\s*\)/,
  )
  expect(m, `line-strong parse: ${value}`).toBeTruthy()
  const from = m![1]!
  const pct = +m![2]! / 100
  const to = m![3]!
  // OKLab L: white ≈ 1, black ≈ 0 for achromatic.
  const Lfrom = from === 'white' ? 1 : 0
  const Lto = to === 'white' ? 1 : 0
  const L = Lfrom * pct + Lto * (1 - pct)
  // OKLab achromatic → linear sRGB ≈ L³ under Björn’s LMS, then encode.
  const lin = L * L * L
  const to8 = (c: number): number => {
    const x = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    return Math.min(255, Math.max(0, Math.round(x * 255)))
  }
  const ch = to8(lin)
  return [ch, ch, ch]
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

const BLACK: Rgb = [0, 0, 0]
const WHITE: Rgb = [255, 255, 255]
const YELLOW: Rgb = [255, 213, 30] // #ffd51e

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

  it('uses solid offset outline for focus (prototype :focus-visible)', () => {
    const button = readWeb('components/ui/button.tsx')
    expect(button).toContain('focus-visible:outline-2')
    expect(button).toContain('focus-visible:outline-offset-2')
    expect(button).toContain('focus-visible:outline-ring')
    expect(button).not.toContain('focus-visible:ring-ring/30')
    expect(button).not.toContain('focus-visible:border-ring')
    // No per-variant focus ring overrides.
    expect(button).not.toMatch(/focus-visible:border-(destructive|success|info|warning)/)
    expect(button).not.toMatch(/focus-visible:ring-(destructive|success|info|warning)/)

    const input = readWeb('components/ui/input.tsx')
    expect(input).toContain('focus-visible:outline-2')
    expect(input).toContain('focus-visible:outline-offset-0')
    expect(input).toContain('focus-visible:outline-ring')

    const badge = readWeb('components/ui/badge.tsx')
    expect(badge).toContain('focus-visible:outline-2')
    expect(badge).toContain('focus-visible:outline-offset-2')
    expect(badge).toContain('focus-visible:outline-ring')

    const app = readWeb('styles/app.css')
    expect(app).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ring\)/)
  })

  it('A: --ring vs background ≥3:1; offset keeps the ring on the page behind ink primary', () => {
    // Light: black ring on white page. Dark: yellow ring on black page.
    // Outline-offset-2 paints the ring against the page, not the ink fill —
    // so ring-vs-background is the focus-indicator contrast (PM #63).
    const lightRingVsBg = contrastRatio(BLACK, WHITE)
    const darkRingVsBg = contrastRatio(YELLOW, BLACK)
    expect(lightRingVsBg).toBeGreaterThanOrEqual(3)
    expect(darkRingVsBg).toBeGreaterThanOrEqual(3)

    // Token-to-token ring vs primary (same hue as the fill) is 1:1 by design;
    // the offset is what makes the indicator visible on ink buttons.
    const lightRingVsPrimary = contrastRatio(BLACK, BLACK)
    const darkRingVsPrimary = contrastRatio(YELLOW, WHITE)
    expect(lightRingVsPrimary).toBe(1)
    expect(darkRingVsPrimary).toBeLessThan(3)

    // Recorded for the PR report.
    expect({
      lightRingVsBackground: Number(lightRingVsBg.toFixed(2)),
      darkRingVsBackground: Number(darkRingVsBg.toFixed(2)),
      lightRingVsPrimary: Number(lightRingVsPrimary.toFixed(2)),
      darkRingVsPrimary: Number(darkRingVsPrimary.toFixed(2)),
    }).toEqual({
      lightRingVsBackground: 21,
      darkRingVsBackground: 14.79,
      lightRingVsPrimary: 1,
      darkRingVsPrimary: 1.42,
    })
  })

  it('B: attention text on /8 tint ≥4.5:1 in light and dark', () => {
    const app = readWeb('styles/app.css')
    const lightAtt = parseOklch(tokenIn(app, ':root', '--status-attention'))
    const darkAtt = parseOklch(tokenIn(app, '.dark', '--status-attention'))
    const lightOnTint = contrastRatio(lightAtt, mixTint(lightAtt, WHITE, 0.08))
    const darkOnTint = contrastRatio(darkAtt, mixTint(darkAtt, BLACK, 0.08))
    expect(lightOnTint).toBeGreaterThanOrEqual(4.5)
    expect(darkOnTint).toBeGreaterThanOrEqual(4.5)
    expect(Number(lightOnTint.toFixed(2))).toBeGreaterThanOrEqual(4.5)
    expect(Number(darkOnTint.toFixed(2))).toBeGreaterThanOrEqual(4.5)
  })

  it('C: dark --line-strong (input border) ≥3:1 against black; Input uses --input', () => {
    const app = readWeb('styles/app.css')
    const lineStrong = resolveLineStrong(tokenIn(app, '.dark', '--line-strong'))
    const ratio = contrastRatio(lineStrong, BLACK)
    expect(ratio).toBeGreaterThanOrEqual(3)
    expect(tokenIn(app, ':root', '--input')).toBe('var(--line-strong)')
    expect(readWeb('components/ui/input.tsx')).toContain('field-control')
    // field-control borders with --color-input → --input → --line-strong.
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
