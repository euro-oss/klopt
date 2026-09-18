import { describe, expect, it } from 'vitest'
import { deleteLineIsOurs, whyNotPostable } from '../../src/lib/entry-form.js'

/**
 * The journaalpost form's two rules.
 *
 * `Cmd`+`D` and `Cmd`+`Backspace` were in the registry, printed in the help
 * sheet, and wired to nothing — and of the two, the delete is the one that can
 * cost somebody work: a bookkeeper halfway through an amount means "clear this
 * field" by it, not "throw the line away".
 */

const field = (over: Partial<Parameters<typeof deleteLineIsOurs>[0]> = {}) =>
  deleteLineIsOurs({
    editable: over.editable ?? true,
    value: over.value ?? '',
    selectionStart: over.selectionStart ?? 0,
    selectionEnd: over.selectionEnd ?? 0,
  })

describe('who owns Cmd-Backspace', () => {
  it('the line, when focus is not in a field at all', () => {
    expect(field({ editable: false, value: 'whatever' })).toBe(true)
  })

  it('the line, when the field is empty', () => {
    expect(field({ value: '' })).toBe(true)
  })

  it('the line, when the caret is at the very start', () => {
    expect(field({ value: '121,00', selectionStart: 0, selectionEnd: 0 })).toBe(true)
  })

  it('the browser, when there is text behind the caret', () => {
    // Deleting the line here would take six characters of typing with it.
    expect(field({ value: '121,00', selectionStart: 6, selectionEnd: 6 })).toBe(false)
  })

  it('the browser, when something is selected', () => {
    expect(field({ value: '121,00', selectionStart: 0, selectionEnd: 6 })).toBe(false)
  })
})

describe('what stops an entry being posted', () => {
  const draft = {
    lineCount: 2,
    difference: 0n,
    description: 'Kantoorartikelen',
    journalCode: 'MEM',
  }

  it('nothing, when it balances and is described', () => {
    expect(whyNotPostable(draft)).toBeNull()
  })

  it('a dagboek nobody chose', () => {
    expect(whyNotPostable({ ...draft, journalCode: '' })).toBe('journal')
  })

  it('an empty omschrijving', () => {
    expect(whyNotPostable({ ...draft, description: '   ' })).toBe('description')
  })

  it('a single line, because an entry has two sides', () => {
    expect(whyNotPostable({ ...draft, lineCount: 1 })).toBe('lines')
  })

  it('a difference between debit and credit, either way round', () => {
    expect(whyNotPostable({ ...draft, difference: 100n })).toBe('balance')
    expect(whyNotPostable({ ...draft, difference: -100n })).toBe('balance')
  })

  it('says the first thing missing rather than all of them', () => {
    // The order a form is filled in: a dagboek before a description before the
    // lines that have to add up.
    expect(whyNotPostable({ lineCount: 0, difference: 5n, description: '', journalCode: '' })).toBe(
      'journal',
    )
  })
})
