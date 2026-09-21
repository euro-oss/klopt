import { describe, expect, it } from 'vitest'
import { SEARCH_RESOURCE_TYPES } from '@klopt/core'
import {
  destinationOf,
  flattenGroups,
  groupHits,
  isSearchable,
  MIN_SEARCH_LENGTH,
  SEARCH_GROUPS,
  type SearchHit,
} from '../../src/lib/palette-search.js'

/**
 * The content half of the command palette.
 *
 * `GET /search` answers with a flat list and an API path per hit. Neither is
 * what a palette shows: a reader wants the hits under a heading they recognise,
 * and `Enter` has to open the *screen*, which is not the path the API reads the
 * record on. Both rules live in one module so they can be checked by naming a
 * hit rather than by driving a browser.
 */

const hit = (type: string, id: string, title = 'Iets'): SearchHit => ({
  type,
  id,
  title,
  subtitle: null,
  date: null,
  amountMinorUnits: null,
  currency: null,
  path: `/${type}s/${id}`,
  rank: 0,
})

describe('when the palette asks the server', () => {
  it('waits for the second character, because the schema requires two', () => {
    // A one-letter query comes back 422, and showing somebody a validation
    // failure for not having finished typing is worse than showing nothing.
    expect(MIN_SEARCH_LENGTH).toBe(2)
    expect(isSearchable('')).toBe(false)
    expect(isSearchable('d')).toBe(false)
    expect(isSearchable('  d  ')).toBe(false)
    expect(isSearchable('de')).toBe(true)
  })
})

describe('grouping the hits', () => {
  it('has a heading for every type the search can return', () => {
    // A type the server knows and this table does not would be shown under its
    // own raw name, which is honest and ugly. The point of the test is that it
    // should not happen by accident.
    expect(SEARCH_GROUPS.map((group) => group.type)).toEqual([...SEARCH_RESOURCE_TYPES])
  })

  it('keeps the groups in one order regardless of what came back first', () => {
    const groups = groupHits([hit('document', 'd1'), hit('contact', 'c1')])
    expect(groups.map((group) => group.type)).toEqual(['contact', 'document'])
  })

  it('drops the empty ones', () => {
    // "Documenten — nothing" on every search is a heading that pushes the
    // answer off the screen.
    const groups = groupHits([hit('contact', 'c1')])
    expect(groups).toHaveLength(1)
  })

  it('shows a type it has no heading for rather than hiding it', () => {
    const groups = groupHits([hit('sputnik', 's1')])
    expect(groups).toEqual([
      { type: 'sputnik', label: null, hits: [expect.objectContaining({ id: 's1' })] },
    ])
  })

  it('flattens back to the list the arrows walk, in the order it is drawn', () => {
    const groups = groupHits([
      hit('journal-entry', 'j1'),
      hit('contact', 'c1'),
      hit('contact', 'c2'),
    ])
    expect(flattenGroups(groups).map((found) => found.id)).toEqual(['c1', 'c2', 'j1'])
  })
})

describe('where Enter on a hit goes', () => {
  it('opens the screen that shows the record, not the path the API reads it on', () => {
    expect(destinationOf(hit('contact', 'abc'))).toEqual({
      kind: 'route',
      to: '/contacts/$contactId',
      params: { contactId: 'abc' },
    })
    expect(destinationOf(hit('sales-invoice', 'abc'))).toEqual({
      kind: 'route',
      to: '/invoices/$invoiceId',
      params: { invoiceId: 'abc' },
    })
    expect(destinationOf(hit('purchase-invoice', 'abc'))).toEqual({
      kind: 'route',
      to: '/purchases/$invoiceId',
      params: { invoiceId: 'abc' },
    })
    expect(destinationOf(hit('journal-entry', 'abc'))).toEqual({
      kind: 'route',
      to: '/entries/$entryId',
      params: { entryId: 'abc' },
    })
  })

  it('opens a document as the file, which is what het postvak does with one', () => {
    // There is no document screen. Inventing one is not this issue's job, and
    // a row that navigates nowhere is worse than one that opens the bijlage.
    expect(destinationOf(hit('document', 'abc'))).toEqual({
      kind: 'download',
      href: '/api/v1/documents/abc',
    })
  })

  it('has somewhere to send every type the search can return', () => {
    for (const type of SEARCH_RESOURCE_TYPES) {
      expect(destinationOf(hit(type, 'abc'))).not.toBeNull()
    }
  })

  it('sends a type it does not know nowhere, rather than guessing', () => {
    expect(destinationOf(hit('sputnik', 'abc'))).toBeNull()
  })
})
