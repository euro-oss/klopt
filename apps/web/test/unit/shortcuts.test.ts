import { describe, expect, it } from 'vitest'
import { GLOBAL_BINDINGS, PREFIXES, resolveKeystroke } from '../../src/lib/shortcut-resolution.js'
import { BINDINGS } from '../../src/lib/keyboard.js'

/**
 * What a keystroke means.
 *
 * The registry was written in M0 and the sidebar has printed its keys ever
 * since, with nothing listening for them. These are the rules that make them
 * real — and the two that are easy to get wrong are the ones about *not*
 * firing: a bare letter while somebody is typing, and a key that a prefix has
 * already claimed.
 */

const stroke = (key: string, overrides: Partial<Parameters<typeof resolveKeystroke>[0]> = {}) => ({
  key,
  hasModifier: false,
  shiftKey: false,
  typing: false,
  ...overrides,
})

describe('resolving a keystroke', () => {
  it('arms `g` and then goes where the second key says', () => {
    expect(resolveKeystroke(stroke('g'), null)).toEqual({ action: 'arm', prefix: 'g' })

    const resolved = resolveKeystroke(stroke('j'), 'g')
    expect(resolved).toMatchObject({ action: 'trigger' })
    expect(resolved.action === 'trigger' && resolved.binding.to).toBe('/entries')
  })

  it('arms `n` for the things you make', () => {
    expect(resolveKeystroke(stroke('n'), null)).toEqual({ action: 'arm', prefix: 'n' })

    const resolved = resolveKeystroke(stroke('i'), 'n')
    expect(resolved.action === 'trigger' && resolved.binding.to).toBe('/purchases/new')
  })

  it('swallows a second key that means nothing', () => {
    // Not passed on. The user was mid-shortcut, and `g` then `1` reaching the
    // koppelscherm would book suggestion one.
    expect(resolveKeystroke(stroke('1'), 'g')).toEqual({ action: 'swallow' })

    // This used to be `g` then `q`, until Alpha 3 gave `q` the auditfile. A
    // punctuation mark rather than another letter, because there is no letter
    // left — see below.
    expect(resolveKeystroke(stroke('.'), 'g')).toEqual({ action: 'swallow' })
  })

  it('has run out of letters after `g`, which is worth knowing before the next screen', () => {
    // Not a rule, an observation with teeth: Alpha 3 took the last two (`q` for
    // de auditfile, `s` for boekjaren) and the alphabet is now full. The next
    // destination needs a second prefix or a different scheme, and the honest
    // place to find that out is here rather than in review.
    const taken = new Set(
      BINDINGS.filter((binding) => binding.keys.startsWith('g ')).map((binding) => binding.keys[2]),
    )
    expect([...'abcdefghijklmnopqrstuvwxyz'].filter((letter) => !taken.has(letter))).toEqual([])
  })

  it('never fires a bare letter while somebody is typing', () => {
    // The difference between `g` navigating and `g` being the first letter of
    // "grootboek" in a description field.
    expect(resolveKeystroke(stroke('g', { typing: true }), null)).toEqual({ action: 'ignore' })
    expect(resolveKeystroke(stroke('?', { typing: true }), null)).toEqual({ action: 'ignore' })
    expect(resolveKeystroke(stroke('j', { typing: true }), 'g')).toEqual({ action: 'ignore' })
  })

  it('does fire a modifier combination while typing', () => {
    // Cmd-K in a text field is unambiguous, and every application the user
    // knows behaves that way.
    const resolved = resolveKeystroke(stroke('k', { hasModifier: true, typing: true }), null)
    expect(resolved.action === 'trigger' && resolved.binding.id).toBe('palette')
  })

  it('opens the help on `?`', () => {
    // `?` needs shift on most layouts, and the binding declares no modifiers —
    // so the shift must not be treated as part of the chord.
    const resolved = resolveKeystroke(stroke('?', { shiftKey: true }), null)
    expect(resolved.action === 'trigger' && resolved.binding.id).toBe('help')
  })

  it('clears an armed prefix on Escape, and otherwise leaves Escape alone', () => {
    expect(resolveKeystroke(stroke('escape'), 'g')).toEqual({ action: 'clear' })
    // Otherwise it belongs to whatever overlay or edit the user is in.
    expect(resolveKeystroke(stroke('escape'), null)).toEqual({ action: 'ignore' })
  })

  it('leaves a screen’s own keys alone', () => {
    // `j`, `k`, `x` and Enter belong to the koppelscherm; a global listener
    // that took them would fight it.
    expect(resolveKeystroke(stroke('j'), null)).toEqual({ action: 'ignore' })
    expect(resolveKeystroke(stroke('x'), null)).toEqual({ action: 'ignore' })
    expect(resolveKeystroke(stroke('enter'), null)).toEqual({ action: 'ignore' })
  })

  it('does not resolve `k` on its own, which the koppelscherm needs', () => {
    // `k` is the palette *with* a modifier and "previous row" without one.
    expect(resolveKeystroke(stroke('k'), null)).toEqual({ action: 'ignore' })
  })

  it('does not survive a modifier held over an armed prefix', () => {
    // `g` then Cmd-K is the palette, not a navigation to nowhere.
    const resolved = resolveKeystroke(stroke('k', { hasModifier: true }), 'g')
    expect(resolved.action === 'trigger' && resolved.binding.id).toBe('palette')
  })
})

describe('what the global listener claims', () => {
  it('is exactly navigation plus the two overlays', () => {
    const owned = new Set(GLOBAL_BINDINGS.map((binding) => binding.id))
    const screenLocal = BINDINGS.filter(
      (binding) => binding.to === undefined && binding.id !== 'palette' && binding.id !== 'help',
    )

    expect(owned.has('palette')).toBe(true)
    expect(owned.has('help')).toBe(true)
    for (const binding of screenLocal) {
      expect(owned.has(binding.id)).toBe(false)
    }
  })

  it('can reach every navigation binding in the registry', () => {
    // The guarantee behind "every shortcut appears in the palette with its
    // key". A binding printed in the sidebar and unreachable here is the bug
    // this whole change exists to fix.
    for (const binding of BINDINGS.filter((entry) => entry.to !== undefined)) {
      const [first, second] = binding.keys.split(' ')
      const resolved =
        second === undefined
          ? resolveKeystroke(stroke(first!), null)
          : resolveKeystroke(stroke(second), first!)

      expect(resolved).toMatchObject({ action: 'trigger' })
      expect(resolved.action === 'trigger' && resolved.binding.id).toBe(binding.id)
    }
  })

  it('derives its prefixes from the registry rather than hard-coding them', () => {
    expect([...PREFIXES].sort()).toEqual(['g', 'n'])
  })
})
