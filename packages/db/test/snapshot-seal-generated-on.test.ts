import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { snapshotSealGeneratedOn } from '../src/snapshot/seal.js'

/** 2027-01-01 00:30 Amsterdam while UTC is still 2026-12-31 (#121). */
const NEW_YEAR_AMSTERDAM = new Date('2026-12-31T23:30:00.000Z')

describe('snapshotSealGeneratedOn', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NEW_YEAR_AMSTERDAM)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the Amsterdam calendar date for XAF generatedOn when sealing', () => {
    expect(snapshotSealGeneratedOn()).toBe('2027-01-01')
  })
})
