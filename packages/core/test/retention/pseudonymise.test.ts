import { describe, expect, it } from 'vitest'
import { pseudonymOf, refusePseudonymisation } from '../../src/retention/pseudonymise.js'

/**
 * Erasing a contact, and the one thing that stops it (spec 7.6).
 */

const subject = {
  number: 'DEB-0001',
  kind: 'company' as const,
  openSales: 0,
  openPurchases: 0,
}

describe('erasing a contact', () => {
  it('names the ledger account rather than leaving a blank row', () => {
    // The column is `not null` and every contact list would render an empty
    // line, which reads as a bug rather than as a decision somebody took.
    expect(pseudonymOf('DEB-0001')).toBe('Gewist contact DEB-0001')
  })

  it('is allowed when nothing is outstanding', () => {
    expect(refusePseudonymisation(subject)).toBeNull()
  })

  it('is refused while a sales invoice is still open', () => {
    // Dunning needs somewhere to send to. Erasing mid-chase leaves a
    // receivable nobody can pursue and a screen that cannot say why.
    expect(refusePseudonymisation({ ...subject, openSales: 2 })).toEqual({
      code: 'has_open_items',
      open: 2,
    })
  })

  it('is refused while a purchase invoice is still open', () => {
    expect(refusePseudonymisation({ ...subject, openPurchases: 1 })).toEqual({
      code: 'has_open_items',
      open: 1,
    })
  })

  it('counts both sides, because either is a reason to wait', () => {
    expect(refusePseudonymisation({ ...subject, openSales: 1, openPurchases: 2 })).toEqual({
      code: 'has_open_items',
      open: 3,
    })
  })

  it('does not consider the retention term, which protects the invoice and not the address book', () => {
    // The seven years keep the invoice readable, and the invoice carries its
    // own copy of the buyer. There is no ground for holding a phone number for
    // seven years because an invoice exists.
    expect(refusePseudonymisation(subject)).toBeNull()
  })
})
