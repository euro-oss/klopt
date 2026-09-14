import { violation, LedgerError } from '../errors.js'
import type { PaymentBatchState } from './model.js'

/**
 * Two people, or nobody (spec 7.4).
 *
 * "SEPA `pain.001` batch export for supplier payments, with a **two-person
 * approval flow**."
 *
 * The rule is one line — the approver must not be the submitter — and the
 * reason it lives in the domain rather than in a handler is that it is the only
 * thing standing between a compromised account and the bank. A permission check
 * says "this person may approve payments". This says "not this payment", which
 * is a different question and the one that matters.
 *
 *     draft ──submit──▶ submitted ──approve──▶ approved ──export──▶ exported
 *                           │
 *                           └──reject──▶ rejected ──▶ (back to draft)
 *
 * A batch is editable only while `draft`. Once submitted its instructions are
 * frozen, because an approval has to mean the approver saw what will be sent —
 * and an approver who approves a batch that then changes has approved nothing.
 */

export type PaymentAction = 'submit' | 'approve' | 'reject' | 'export' | 'reopen'

const ALLOWED: Readonly<Record<PaymentAction, readonly PaymentBatchState[]>> = {
  submit: ['draft'],
  approve: ['submitted'],
  reject: ['submitted'],
  export: ['approved'],
  // A rejected batch goes back to draft to be corrected. An approved one does
  // not: withdrawing an approval is a new approval decision, so it is a reject.
  reopen: ['rejected'],
}

const RESULT: Readonly<Record<PaymentAction, PaymentBatchState>> = {
  submit: 'submitted',
  approve: 'approved',
  reject: 'rejected',
  export: 'exported',
  reopen: 'draft',
}

export interface BatchActor {
  /** The actor id — a user, or a token's principal. Compared, not resolved. */
  readonly userId: string
  /** Who submitted it, if anybody has. */
  readonly submittedBy: string | null
  /**
   * `human`, `script` or `agent`.
   *
   * An approval by a script defeats the control it exists to be: the point of
   * a second person is human judgement, and a scheduled job that approves
   * whatever was submitted is one person with a cron entry. A token is fine —
   * a human working through the API is a legitimate caller — but it has to be
   * a human's token.
   */
  readonly actorKind: 'human' | 'script' | 'agent'
}

export function nextState(
  action: PaymentAction,
  current: PaymentBatchState,
  actor: BatchActor,
): PaymentBatchState {
  if (!ALLOWED[action].includes(current)) {
    throw new LedgerError([
      violation('wrong_batch_state', 'state', {
        current,
        actionPast:
          action === 'reopen' ? 'reopened' : `${action}${action.endsWith('e') ? 'd' : 'ed'}`,
      }),
    ])
  }

  /**
   * The whole point.
   *
   * Note it applies to `approve` only: rejecting your own submission is fine —
   * spotting your own mistake should never require a second person — and
   * exporting an approved batch is clerical.
   */
  if (action === 'approve') {
    if (actor.actorKind !== 'human') {
      throw new LedgerError([violation('approval_by_submitter.not_a_script', 'approvedBy')])
    }
    if (actor.submittedBy !== null && actor.submittedBy === actor.userId) {
      throw new LedgerError([violation('approval_by_submitter.not_the_submitter', 'approvedBy')])
    }
  }

  return RESULT[action]
}

/** Can this batch's instructions still be changed? */
export function isEditable(state: PaymentBatchState): boolean {
  return state === 'draft'
}
