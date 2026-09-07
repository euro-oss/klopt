import { violation, LedgerError } from '../errors.js'

/**
 * A purchase invoice, and the states it goes through (spec 15, M4).
 *
 * ## Why this is not sales with the signs flipped
 *
 * On a sales invoice we are the authority on every figure: we set the price, we
 * apply the rate, and the document we produce is correct by construction. On a
 * purchase invoice the *supplier* is the authority. The document says what we
 * owe and what we may deduct, and our arithmetic disagreeing with theirs does
 * not make the document wrong — it makes it a question for a human.
 *
 * So the purchase side records the supplier's stated net, VAT and total as
 * given, and *verifies* them. See `check.ts`: totals that do not add up are
 * blocking, because then the document has not been captured faithfully; a rate
 * that does not match ours is a warning, because the supplier may have rounded
 * per line where we round per invoice, or the line may cover two rates.
 *
 * ## The states
 *
 *     draft ──book──▶ booked ──approve──▶ approved ──▶ (paid, via a batch)
 *                        │                    │
 *                        ├──dispute──▶ disputed ──resolve──▶ booked
 *                        │
 *     cancelled ◀──cancel┘ (draft only; a booked invoice is reversed instead)
 *
 * **Booking happens on receipt, not on approval.** An invoice that has arrived
 * is a liability whether anybody has authorised it yet, and the VAT on it is
 * deductible in the period of the invoice date — which may well be closed by
 * the time an approver gets to it. Waiting for approval would mean either a
 * late deduction or a suppletie, every time somebody went on holiday.
 *
 * Approval therefore gates *payment*, not the ledger. That is also what makes
 * it fit what M2 already built: a payment batch may only include approved
 * invoices, and the two-person control on the payment file is still there.
 *
 * A `disputed` invoice stays booked — the liability is real until it is settled
 * or credited — but cannot be paid. Withdrawing a booking is a reversal, per
 * the correction doctrine: nothing in the journal is ever edited.
 */

export type PurchaseInvoiceStatus = 'draft' | 'booked' | 'approved' | 'disputed' | 'cancelled'

export type PurchaseInvoiceKind = 'invoice' | 'credit_note'

export type PurchaseAction = 'book' | 'approve' | 'dispute' | 'resolve' | 'cancel'

const ALLOWED: Readonly<Record<PurchaseAction, readonly PurchaseInvoiceStatus[]>> = {
  book: ['draft'],
  approve: ['booked'],
  // An approved invoice can still be disputed: a problem found after
  // authorisation is exactly when it matters most.
  dispute: ['booked', 'approved'],
  resolve: ['disputed'],
  // Only a draft. A booked invoice is reversed, because its entry exists.
  cancel: ['draft'],
}

const RESULT: Readonly<Record<PurchaseAction, PurchaseInvoiceStatus>> = {
  book: 'booked',
  approve: 'approved',
  dispute: 'disputed',
  // Back to booked, not to approved: resolving a dispute does not restore an
  // authorisation that was given before the problem was known.
  resolve: 'booked',
  cancel: 'cancelled',
}

const DUTCH: Readonly<Record<PurchaseInvoiceStatus, string>> = {
  draft: 'concept',
  booked: 'geboekt',
  approved: 'goedgekeurd',
  disputed: 'in geschil',
  cancelled: 'vervallen',
}

export function purchaseStatusLabel(status: PurchaseInvoiceStatus): string {
  return DUTCH[status]
}

export interface PurchaseActor {
  /** The actor id. Compared, not resolved. */
  readonly userId: string
  readonly actorKind: 'human' | 'script' | 'agent'
}

export interface PurchaseTransition {
  readonly from: PurchaseInvoiceStatus
  readonly to: PurchaseInvoiceStatus
  readonly action: PurchaseAction
}

/**
 * Whether an action is allowed, and what it produces.
 *
 * Unlike a payment batch, approving one's own purchase invoice is allowed. The
 * two-person control that matters stands between the books and the bank, and it
 * is already there: a payment file needs a second person whatever the invoice
 * says. Demanding a second person here as well would leave a one-person BV
 * unable to authorise any cost at all, which is not a control — it is a
 * product that does not work for its commonest user.
 *
 * What is refused is approval by a script. The point of an authorisation is
 * that somebody looked, and a scheduled job that approves whatever arrives is
 * not somebody looking.
 */
export function nextPurchaseStatus(
  action: PurchaseAction,
  current: PurchaseInvoiceStatus,
  actor: PurchaseActor,
): PurchaseTransition {
  if (!ALLOWED[action].includes(current)) {
    throw new LedgerError([
      violation(
        'wrong_invoice_state',
        'status',
        `An invoice that is ${purchaseStatusLabel(current)} cannot be ${action}ed. That is allowed from: ${ALLOWED[action].map(purchaseStatusLabel).join(', ')}.`,
        { status: current, action },
      ),
    ])
  }

  if (action === 'approve' && actor.actorKind !== 'human') {
    throw new LedgerError([
      violation(
        'approval_by_script',
        'actor',
        'An approval has to be somebody looking. A script cannot authorise a cost, though a human working through the API with a token can.',
        { actorKind: actor.actorKind },
      ),
    ])
  }

  return { from: current, to: RESULT[action], action }
}

/** Whether this invoice may go into a payment batch. */
export function isPayable(status: PurchaseInvoiceStatus): boolean {
  return status === 'approved'
}

/** Why it may not, in words an operator can act on. */
export function payableRefusal(status: PurchaseInvoiceStatus): string | null {
  switch (status) {
    case 'approved':
      return null
    case 'booked':
      return 'Deze factuur is nog niet goedgekeurd.'
    case 'draft':
      return 'Deze factuur is nog een concept en staat nog niet in de boeken.'
    case 'disputed':
      return 'Deze factuur staat in geschil en wordt niet betaald zolang dat zo is.'
    case 'cancelled':
      return 'Deze factuur is vervallen.'
  }
}
