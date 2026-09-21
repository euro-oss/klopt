import { describe, expect, it } from 'vitest'
import { en } from '../../src/i18n/en.js'
import { nl } from '../../src/i18n/nl.js'
import { BINDINGS, BINDINGS_BY_ID, bindingChips, formatBinding } from '../../src/lib/keyboard.js'

/**
 * The keyboard map is a contract (spec 11.3), and nothing was enforcing the one
 * property that makes it one: two actions on the same key means one of them
 * silently does not work. That is exactly what happened when BTW tried to claim
 * `g w` from the winst- en verliesrekening.
 */

describe('the keyboard map', () => {
  it('gives every binding a unique id', () => {
    const ids = BINDINGS.map((binding) => binding.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never puts two actions on the same chord within a group', () => {
    // The chord, not the key: `Enter` and `Cmd-Enter` are two chords, which is
    // how posting an entry and posting-and-next coexist. Across groups a repeat
    // is legitimate — `Enter` commits in every context. Within one it is a
    // collision, and the second binding never fires.
    const seen = new Map<string, string>()
    const collisions: string[] = []

    for (const binding of BINDINGS) {
      const chord = [...(binding.modifiers ?? [])].sort().join('+')
      const key = `${binding.group} ${chord} ${binding.keys}`
      const previous = seen.get(key)
      if (previous !== undefined) {
        collisions.push(`${key}: ${previous} and ${binding.id}`)
      }
      seen.set(key, binding.id)
    }

    expect(collisions).toEqual([])
  })

  it('never puts two navigations on the same keys, whatever their group', () => {
    // A `g`-prefixed key resolves globally, so two of them collide even if
    // somebody files them under different headings.
    const navigations = BINDINGS.filter((binding) => binding.to !== undefined)
    const keys = navigations.map((binding) => binding.keys)
    expect(new Set(keys).size, keys.join(', ')).toBe(keys.length)
  })

  it('gives every binding a label and keys somebody could read out', () => {
    for (const binding of BINDINGS) {
      expect(binding.keys.length, binding.id).toBeGreaterThan(0)
      expect(formatBinding(binding).length, binding.id).toBeGreaterThan(0)
    }
  })

  it('names every binding with a message key that resolves', () => {
    // The labels became keys, so asserting they are non-empty strings would
    // pass for `nav.thing-i-invented`. What matters is that the palette can
    // show a word — in both languages, since the palette also searches on it.
    for (const binding of BINDINGS) {
      expect(nl[binding.label], binding.id).toBeTruthy()
      expect(nl[binding.group], binding.id).toBeTruthy()
      expect(en[binding.label], binding.id).toBeTruthy()
      expect(en[binding.group], binding.id).toBeTruthy()
    }
  })

  it('prints a key the way a keycap does', () => {
    // The chrome on the screens is built from these, so `SPACE` and `A-Z` in
    // raw upper case are not a detail: they are what somebody reads.
    const chips = (id: string) => bindingChips(BINDINGS_BY_ID.get(id)!)

    expect(chips('list.select')).toEqual(['Space'])
    expect(chips('list.typeAhead')).toEqual(['A–Z'])
    expect(chips('picker.next')).toEqual(['Tab'])
    expect(chips('inbox.leave')).toEqual(['Esc'])
  })

  it('gives a chord one cap and a sequence two', () => {
    // `Ctrl` rather than `⌘`, because the tests run where `navigator.platform`
    // is not a Mac — which is the same resolution the screens get.
    expect(bindingChips(BINDINGS_BY_ID.get('entry.post')!)).toEqual(['Ctrl↵'])
    expect(bindingChips(BINDINGS_BY_ID.get('entry.postAndNext')!)).toEqual(['Ctrl⇧↵'])
    expect(bindingChips(BINDINGS_BY_ID.get('go.dashboard')!)).toEqual(['G', 'D'])
  })

  it('indexes every binding by id', () => {
    expect(BINDINGS_BY_ID.size).toBe(BINDINGS.length)
    for (const binding of BINDINGS) {
      expect(BINDINGS_BY_ID.get(binding.id)).toBe(binding)
    }
  })
})
