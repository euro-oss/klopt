import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_THEME, isTheme, resolveTheme, themeClass } from '../../src/lib/theme.js'

/**
 * Two themes, light first.
 *
 * The rules are small enough to state: what was chosen wins, anything else is
 * light, and dark is the only one that puts a class on the document. They are
 * worth a test anyway, because "the default" is the kind of thing that drifts
 * into "whatever the operating system says" the first time somebody reaches
 * for `matchMedia`.
 */

describe('which theme a request gets', () => {
  it('is light when nobody has chosen', () => {
    expect(resolveTheme(null)).toBe('light')
    expect(resolveTheme(undefined)).toBe('light')
    expect(DEFAULT_THEME).toBe('light')
  })

  it('is what was chosen', () => {
    expect(resolveTheme('dark')).toBe('dark')
    expect(resolveTheme('light')).toBe('light')
  })

  it('is light when the cookie says something else entirely', () => {
    // A stale or hand-edited cookie should not be able to produce a third
    // theme, or none.
    expect(resolveTheme('midnight')).toBe('light')
    expect(resolveTheme('')).toBe('light')
  })

  it('knows a theme from a word', () => {
    expect(isTheme('dark')).toBe(true)
    expect(isTheme('Dark')).toBe(false)
    expect(isTheme(null)).toBe(false)
  })
})

describe('what the document carries', () => {
  it('marks dark and leaves light unmarked', () => {
    // Light being the absence of a class is what makes it the default in the
    // stylesheet as well as in the resolver.
    expect(themeClass('dark')).toBe('dark')
    expect(themeClass('light')).toBeUndefined()
  })
})

describe('the palette', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'styles', 'app.css'),
    'utf8',
  )

  it('is white, black and yellow, and says so in one place', () => {
    expect(css).toContain('--white: #ffffff')
    expect(css).toContain('--black: #000000')
    expect(css).toContain('--yellow: #ffd51e')
  })

  it('ships none of the marketing site’s purple', () => {
    // The two diverged on colour. A hex from over there appearing here is the
    // regression this guards: it would arrive by copying a component, not by
    // anybody deciding it.
    for (const banned of ['#5003c0', '#ab03a9', '#ff467a', '#ceb8ed', '#c44fc3', '#4c0158']) {
      expect(css.toLowerCase(), banned).not.toContain(banned)
    }
  })

  it('does not paint an error in the accent colour', () => {
    // "Yellow is the accent" and "this went wrong" are different statements,
    // and a screen where the button and the error are the same colour makes
    // neither.
    expect(css).toContain('--destructive: var(--status-error)')
    expect(css).not.toContain('--destructive: var(--yellow)')
  })

  it('defines both themes, with light needing no class', () => {
    expect(css).toContain(':root {')
    expect(css).toContain('.dark {')
    expect(css).toContain('color-scheme: light')
    expect(css).toContain('color-scheme: dark')
  })

  it('keeps every corner square', () => {
    expect(css).toContain('--radius: 0rem')
  })
})

/**
 * The rules that are not about a token, held to the source.
 *
 * Colour lives in one file and is already guarded above. These four are the
 * ones that come back a class at a time — a `shadow-lg` copied from a
 * component somewhere, a `font-mono` on a column of figures, a `rounded-full`
 * avatar, a weight the record does not have. Each is a one-line decision of
 * record and none of them is visible in a diff unless somebody is looking for
 * it, which is what a test is for.
 *
 * Generated components are in scope on purpose: `shadcn add` is free to
 * reintroduce any of these, and when it does, this should say so.
 *
 * `ring-*` is deliberately not in the list. It draws with a box-shadow and it
 * is the focus indicator, which the design has rather than forbids.
 */
describe('the rules that live in class names', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')

  const sources = (): readonly { path: string; text: string }[] => {
    const found: { path: string; text: string }[] = []
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.(ts|tsx|css)$/.test(entry.name))
          found.push({ path, text: readFileSync(path, 'utf8') })
      }
    }
    walk(SRC)
    return found
  }

  const forbidden = [
    ['no shadows', /\bshadow-(sm|md|lg|xl|2xl|inner)\b/],
    ['square corners', /\brounded-full\b/],
    ['one typeface', /\bfont-mono\b/],
    ['three weights', /\bfont-(thin|extralight|light|bold|extrabold|black)\b/],
  ] as const

  for (const [rule, pattern] of forbidden) {
    it(rule, () => {
      const offenders = sources()
        .filter((file) => pattern.test(file.text))
        .map((file) => file.path.slice(SRC.length + 1))

      expect(offenders, `${rule}: ${offenders.join(', ')}`).toEqual([])
    })
  }

  it('picks colour by meaning, not by literal', () => {
    // Outside the token block there is no such thing as a colour: a hex in a
    // component is a palette nobody agreed to.
    const offenders = sources()
      .filter((file) => !file.path.endsWith(join('styles', 'app.css')))
      .filter((file) => /#[0-9a-fA-F]{6}\b/.test(file.text))
      .map((file) => file.path.slice(SRC.length + 1))

    expect(offenders, offenders.join(', ')).toEqual([])
  })
})
