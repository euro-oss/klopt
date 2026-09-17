import { describe, expect, it } from 'vitest'
import {
  isPayable,
  nextPurchaseStatus,
  payableRefusal,
  purchaseStatusLabel,
  type PurchaseAction,
  type PurchaseInvoiceStatus,
} from '../../src/index.js'

/**
 * The approval flow.
 *
 * What is worth testing is the shape of the graph, not each edge: that booking
 * happens before approval rather than after it, that only an approved invoice
 * is payable, and that a script cannot authorise a cost.
 */

const human = { userId: 'alice', actorKind: 'human' as const }
const script = { userId: 'cron', actorKind: 'script' as const }

describe('nextPurchaseStatus', () => {
  it('books on receipt and approves afterwards', () => {
    // The order that matters: an invoice that has arrived is a liability, and
    // its VAT is deductible in the period of the invoice date. Waiting for an
    // approver would mean a late deduction every time somebody went away.
    expect(nextPurchaseStatus('book', 'draft', human).to).toBe('booked')
    expect(nextPurchaseStatus('approve', 'booked', human).to).toBe('approved')
  })

  it('refuses to approve something that is not in the books yet', () => {
    expect(() => nextPurchaseStatus('approve', 'draft', human)).toThrow(/concept/)
  })

  it('refuses to book something twice', () => {
    expect(() => nextPurchaseStatus('book', 'booked', human)).toThrow(/geboekt/)
  })

  it('lets an approved invoice still be disputed', () => {
    // A problem found after authorisation is when it matters most.
    expect(nextPurchaseStatus('dispute', 'approved', human).to).toBe('disputed')
    expect(nextPurchaseStatus('dispute', 'booked', human).to).toBe('disputed')
  })

  it('sends a resolved dispute back to booked, not to approved', () => {
    // Resolving does not restore an authorisation given before the problem was
    // known: somebody has to look again.
    expect(nextPurchaseStatus('resolve', 'disputed', human).to).toBe('booked')
  })

  it('cancels only a draft, because a booked invoice has an entry', () => {
    expect(nextPurchaseStatus('cancel', 'draft', human).to).toBe('cancelled')
    // Withdrawing a booking is a reversal. Nothing in the journal is edited.
    expect(() => nextPurchaseStatus('cancel', 'booked', human)).toThrow(/geboekt/)
    expect(() => nextPurchaseStatus('cancel', 'approved', human)).toThrow()
  })

  it('lets a human approve their own invoice, unlike a payment file', () => {
    // The two-person control stands between the books and the bank, and it is
    // already on the payment. Demanding a second person here would leave a
    // one-person BV unable to authorise any cost at all.
    expect(nextPurchaseStatus('approve', 'booked', human).to).toBe('approved')
  })

  it('refuses an approval by a script', () => {
    expect(() => nextPurchaseStatus('approve', 'booked', script)).toThrow(/somebody looking/)
  })

  it('lets a script do everything except approve', () => {
    for (const action of ['book', 'dispute', 'cancel'] as const) {
      const from: PurchaseInvoiceStatus = action === 'dispute' ? 'booked' : 'draft'
      expect(() => nextPurchaseStatus(action, from, script)).not.toThrow()
    }
  })

  it('names the states it would have accepted, in Dutch', () => {
    let message = ''
    try {
      nextPurchaseStatus('resolve', 'draft', human)
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : ''
    }
    expect(message).toContain('in geschil')
  })
})

describe('isPayable', () => {
  it('is true only when approved', () => {
    const states: readonly PurchaseInvoiceStatus[] = [
      'draft',
      'booked',
      'approved',
      'disputed',
      'cancelled',
    ]
    expect(states.filter(isPayable)).toEqual(['approved'])
  })

  it('says why not, in words an operator can act on', () => {
    expect(payableRefusal('approved')).toBeNull()
    expect(payableRefusal('booked')).toContain('nog niet goedgekeurd')
    expect(payableRefusal('disputed')).toContain('geschil')
    expect(payableRefusal('draft')).toContain('concept')
    expect(payableRefusal('cancelled')).toContain('vervallen')
  })
})

describe('purchaseStatusLabel', () => {
  it('has Dutch for every state, because every state reaches a screen', () => {
    const actions: readonly PurchaseAction[] = ['book', 'approve', 'dispute', 'resolve', 'cancel']
    expect(actions).toHaveLength(5)
    for (const status of ['draft', 'booked', 'approved', 'disputed', 'cancelled'] as const) {
      expect(purchaseStatusLabel(status).length).toBeGreaterThan(3)
    }
  })
})
