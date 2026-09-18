import { describe, expect, it } from 'vitest'
import {
  nextTypeAhead,
  resolveTableKey,
  toTsv,
  typeAheadTarget,
  type TableKeystroke,
} from '../../src/lib/table-keyboard.js'

/**
 * The list keyboard, tested by naming keys.
 *
 * `docs/keyboard-map.md` has promised a row cursor, type-ahead, a selection and
 * a copy that lands in a spreadsheet since before the tables existed. The
 * tables made rows focusable and stopped there, which is the failure mode the
 * map exists to prevent — so the rules are asserted here rather than only in a
 * browser.
 */

const press = (key: string, held: Partial<Omit<TableKeystroke, 'key'>> = {}): TableKeystroke => ({
  key,
  modKey: held.modKey ?? false,
  shiftKey: held.shiftKey ?? false,
  altKey: held.altKey ?? false,
})

const list = { index: 2, count: 10, page: 5 }

describe('moving the cursor through a table', () => {
  it('moves on the arrows', () => {
    expect(resolveTableKey(press('ArrowDown'), list)).toEqual({
      action: 'move',
      index: 3,
      extend: false,
    })
    expect(resolveTableKey(press('ArrowUp'), list)).toEqual({
      action: 'move',
      index: 1,
      extend: false,
    })
  })

  it('moves on j and k, like the other two lists in this application', () => {
    expect(resolveTableKey(press('j'), list)).toEqual({ action: 'move', index: 3, extend: false })
    expect(resolveTableKey(press('k'), list)).toEqual({ action: 'move', index: 1, extend: false })
  })

  it('moves by a viewport on PageUp and PageDown', () => {
    expect(resolveTableKey(press('PageDown'), list)).toEqual({
      action: 'move',
      index: 7,
      extend: false,
    })
    expect(resolveTableKey(press('PageUp'), list)).toEqual({
      action: 'move',
      index: 0,
      extend: false,
    })
  })

  it('goes to the ends on Home and End', () => {
    expect(resolveTableKey(press('Home'), list)).toEqual({
      action: 'move',
      index: 0,
      extend: false,
    })
    expect(resolveTableKey(press('End'), list)).toEqual({ action: 'move', index: 9, extend: false })
  })

  it('stops at both ends rather than wrapping', () => {
    expect(resolveTableKey(press('ArrowUp'), { index: 0, count: 10, page: 5 })).toEqual({
      action: 'move',
      index: 0,
      extend: false,
    })
    expect(resolveTableKey(press('ArrowDown'), { index: 9, count: 10, page: 5 })).toEqual({
      action: 'move',
      index: 9,
      extend: false,
    })
  })

  it('moves from the end when the cursor has outlived its row', () => {
    // The list shortened underneath somebody who had scrolled past the new end.
    expect(resolveTableKey(press('ArrowUp'), { index: 40, count: 10, page: 5 })).toEqual({
      action: 'move',
      index: 8,
      extend: false,
    })
  })

  it('extends the selection when shift is held on an arrow', () => {
    expect(resolveTableKey(press('ArrowDown', { shiftKey: true }), list)).toEqual({
      action: 'move',
      index: 3,
      extend: true,
    })
  })
})

describe('what a table does with the rest of the keyboard', () => {
  it('opens the row the cursor is on', () => {
    expect(resolveTableKey(press('Enter'), list)).toEqual({ action: 'open', index: 2 })
  })

  it('selects one row on space', () => {
    expect(resolveTableKey(press(' '), list)).toEqual({ action: 'toggle', index: 2 })
  })

  it('selects every loaded row on mod-A', () => {
    expect(resolveTableKey(press('a', { modKey: true }), list)).toEqual({ action: 'selectAll' })
  })

  it('copies on mod-C', () => {
    expect(resolveTableKey(press('c', { modKey: true }), list)).toEqual({ action: 'copy' })
  })

  it('leaves everything else modified alone', () => {
    // `Cmd`+`K` is the palette and `Cmd`+`Enter` posts an entry. A table that
    // took either would be a table nobody could work around.
    expect(resolveTableKey(press('k', { modKey: true }), list)).toEqual({ action: 'ignore' })
    expect(resolveTableKey(press('Enter', { modKey: true }), list)).toEqual({ action: 'ignore' })
    expect(resolveTableKey(press('ArrowDown', { altKey: true }), list)).toEqual({
      action: 'ignore',
    })
  })

  it('leaves the list on Escape', () => {
    expect(resolveTableKey(press('Escape'), list)).toEqual({ action: 'leave' })
    expect(resolveTableKey(press('Escape'), { index: 0, count: 0, page: 5 })).toEqual({
      action: 'leave',
    })
  })

  it('takes a printable character as type-ahead', () => {
    expect(resolveTableKey(press('4'), list)).toEqual({ action: 'typeAhead', character: '4' })
    expect(resolveTableKey(press('D', { shiftKey: true }), list)).toEqual({
      action: 'typeAhead',
      character: 'D',
    })
  })

  it('gives j and k to the cursor, and a capital to type-ahead', () => {
    // Somebody looking for Kantoorkosten has to be able to type a K, and
    // somebody moving through the rows has to be able to press k.
    expect(resolveTableKey(press('j'), list).action).toBe('move')
    expect(resolveTableKey(press('K', { shiftKey: true }), list)).toEqual({
      action: 'typeAhead',
      character: 'K',
    })
  })

  it('does nothing at all to an empty table', () => {
    expect(resolveTableKey(press('ArrowDown'), { index: 0, count: 0, page: 5 })).toEqual({
      action: 'ignore',
    })
  })
})

describe('type-ahead', () => {
  const chart = ['1100 Bank', '1300 Debiteuren', '1500 Af te dragen BTW', '4400 Kantoorkosten']

  it('jumps to the first row that starts with the fragment', () => {
    expect(typeAheadTarget(chart, '4', 0)).toBe(3)
    expect(typeAheadTarget(chart, '15', 0)).toBe(2)
  })

  it('walks through the rows when one character is pressed again', () => {
    expect(typeAheadTarget(chart, '1', 0)).toBe(1)
    expect(typeAheadTarget(chart, '1', 1)).toBe(2)
    // And comes back round rather than stopping at the bottom.
    expect(typeAheadTarget(chart, '1', 2)).toBe(0)
  })

  it('keeps the row it found when the fragment grows', () => {
    // `1` found 1100; `11` must not skip past it to the next match.
    expect(typeAheadTarget(chart, '11', 0)).toBe(0)
  })

  it('is nothing when nothing matches', () => {
    expect(typeAheadTarget(chart, 'zz', 0)).toBeNull()
    expect(typeAheadTarget(chart, '', 0)).toBeNull()
    expect(typeAheadTarget([], '1', 0)).toBeNull()
  })

  it('grows the fragment while somebody is still typing', () => {
    expect(nextTypeAhead({ buffer: '1', at: 1_000 }, '4', 1_400)).toEqual({
      buffer: '14',
      at: 1_400,
    })
  })

  it('starts a fresh fragment after a pause', () => {
    // Otherwise the `4` somebody types a minute later searches for `14`, finds
    // nothing, and the keyboard looks broken.
    expect(nextTypeAhead({ buffer: '1', at: 1_000 }, '4', 9_000)).toEqual({
      buffer: '4',
      at: 9_000,
    })
  })
})

describe('the selection as a spreadsheet reads it', () => {
  it('is tabs between cells and newlines between rows', () => {
    expect(
      toTsv([
        ['Nr.', 'Omschrijving', 'Debet'],
        ['1', 'Kantoorkosten', '121,00'],
      ]),
    ).toBe('Nr.\tOmschrijving\tDebet\n1\tKantoorkosten\t121,00')
  })

  it('collapses whitespace inside a cell rather than quoting it', () => {
    // TSV has no quoting convention, so a tab inside a cell is not an escaped
    // tab — it is a new column and every row after it landing one place over.
    expect(toTsv([['a\tb', 'c\nd', '  e  ']])).toBe('a b\tc d\te')
  })

  it('is empty for an empty selection', () => {
    expect(toTsv([])).toBe('')
  })
})
