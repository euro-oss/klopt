import { describe, expect, it } from 'vitest'
import {
  retainUntil,
  retentionState,
  summariseRetention,
  type RetentionSubject,
} from '../../src/index.js'

/**
 * The bewaarplicht, as arithmetic and as a decision.
 *
 * The cases that matter are the ones where the obvious answer is wrong: a book
 * year that is not a calendar year, a document with no book year at all, and a
 * legal hold over an expired date — which is the whole reason a hold exists.
 */

const subject = (overrides: Partial<RetentionSubject> = {}): RetentionSubject => ({
  id: 'doc-1',
  retainUntil: '2033-12-31',
  retentionClass: 'standard',
  legalHold: false,
  deletedAt: null,
  ...overrides,
})

const state = (over: Partial<RetentionSubject> = {}, asOf = '2030-01-01', hold = false) =>
  retentionState(subject(over), { asOf, entityLegalHold: hold })

describe('how long a document is kept', () => {
  it('is seven years after the book year ends', () => {
    // Records for 2026 must be kept until 31 December 2033.
    expect(retainUntil('2026-12-31', 'standard')).toBe('2033-12-31')
  })

  it('is ten years for onroerend goed', () => {
    // Article 34a Wet OB: the revision period for a building is nine years
    // after the year it was first used, so seven is not enough.
    expect(retainUntil('2026-12-31', 'immovable_property')).toBe('2036-12-31')
  })

  it('follows a book year that is not a calendar year', () => {
    // Spec 6.4: a boekjaar need not be a calendar year, and a shifted one
    // shifts its retention with it.
    expect(retainUntil('2027-06-30', 'standard')).toBe('2034-06-30')
    expect(retainUntil('2027-03-31', 'standard')).toBe('2034-03-31')
  })

  it('does not roll a leap day into March', () => {
    // 29 February plus seven years is a question `Date` answers by rolling
    // over. Clamping to the 28th shortens nothing that matters.
    expect(retainUntil('2024-02-29', 'standard')).toBe('2031-02-28')
    // And keeps the day when the target year has one.
    expect(retainUntil('2024-02-29', 'immovable_property')).toBe('2034-02-28')
    expect(retainUntil('2020-02-29', 'standard')).toBe('2027-02-28')
    expect(retainUntil('2016-02-29', 'immovable_property')).toBe('2026-02-28')
  })

  it('keeps a leap day that survives', () => {
    expect(retainUntil('2028-02-29', 'immovable_property')).toBe('2038-02-28')
    // 2032 + 4 = 2036, which is a leap year.
    expect(retainUntil('2032-02-29', 'standard')).toBe('2039-02-28')
  })

  it('refuses a date it cannot read', () => {
    expect(() => retainUntil('31-12-2026', 'standard')).toThrow(RangeError)
    expect(() => retainUntil('', 'standard')).toThrow(RangeError)
  })
})

describe('whether a document may be deleted', () => {
  it('says no while the term is running, with the date', () => {
    const result = state({}, '2030-01-01')
    expect(result.code).toBe('retained')
    expect(result.deletable).toBe(false)
    expect(result.reason).toContain('2033-12-31')
  })

  it('says no on the last day itself', () => {
    // Kept until that date *inclusive*: on the day, it is still retained.
    expect(state({}, '2033-12-31').code).toBe('retained')
    expect(state({}, '2034-01-01').code).toBe('expired')
  })

  it('says yes once the term has run out', () => {
    const result = state({}, '2034-06-01')
    expect(result.code).toBe('expired')
    expect(result.deletable).toBe(true)
  })

  it('a legal hold beats an expired term, which is what a hold is for', () => {
    // A dispute or an investigation outlives the bewaarplicht, and the whole
    // point is that the clock stops mattering.
    const result = state({ legalHold: true }, '2040-01-01')
    expect(result.code).toBe('held')
    expect(result.deletable).toBe(false)
  })

  it('an administration-wide hold beats everything, and is checked first', () => {
    // A firm under investigation should not have to flag forty thousand rows.
    const result = state({ legalHold: false }, '2040-01-01', true)
    expect(result.code).toBe('held')
    expect(result.reason).toContain('whole administration')
  })

  it('refuses to delete a document whose book year is unknown', () => {
    // Not knowing how long something must be kept is not a licence to throw it
    // away. This is the case that would otherwise read as "no date, no rule".
    const result = state({ retainUntil: null }, '2040-01-01')
    expect(result.code).toBe('undated')
    expect(result.deletable).toBe(false)
  })

  it('will not delete something twice', () => {
    const result = state({ deletedAt: '2035-01-05T10:00:00.000Z' }, '2040-01-01')
    expect(result.code).toBe('deleted')
    expect(result.deletable).toBe(false)
  })
})

describe('the preview', () => {
  it('counts every state, not only what it would delete', () => {
    // An operator wondering why nothing is deletable needs an answer, and a
    // preview that only counts the deletable is half a preview.
    const summary = summariseRetention(
      [
        { ...subject({ id: 'a', retainUntil: '2030-12-31' }), sizeBytes: 1_000 },
        { ...subject({ id: 'b', retainUntil: '2030-12-31' }), sizeBytes: 2_000 },
        { ...subject({ id: 'c', retainUntil: '2040-12-31' }), sizeBytes: 4_000 },
        { ...subject({ id: 'd', retainUntil: '2030-12-31', legalHold: true }), sizeBytes: 8_000 },
        { ...subject({ id: 'e', retainUntil: null }), sizeBytes: 16_000 },
        {
          ...subject({ id: 'f', retainUntil: '2030-12-31', deletedAt: '2031-01-01T00:00:00Z' }),
          sizeBytes: 32_000,
        },
      ],
      { asOf: '2035-01-01', entityLegalHold: false },
    )

    expect(summary.documents).toBe(6)
    expect(summary.byState).toEqual({
      expired: 2,
      retained: 1,
      held: 1,
      undated: 1,
      deleted: 1,
    })
    // Only the two expired ones, and nothing was freed by looking.
    expect(summary.deletableBytes).toBe(3_000n)
  })

  it('frees nothing at all while the administration is held', () => {
    const summary = summariseRetention(
      [{ ...subject({ retainUntil: '2020-12-31' }), sizeBytes: 1_000 }],
      { asOf: '2035-01-01', entityLegalHold: true },
    )

    expect(summary.byState.expired).toBe(0)
    expect(summary.byState.held).toBe(1)
    expect(summary.deletableBytes).toBe(0n)
  })
})
