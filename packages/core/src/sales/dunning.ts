import { violation, LedgerError } from '../errors.js'

/**
 * Chasing an unpaid invoice (spec 7, "dunning").
 *
 * Three things make this less trivial than "send an email after 14 days".
 *
 * **The stage is derived, never stored.** Which reminder an invoice is due is a
 * function of its due date, today, and what has already been sent. A column
 * would have to be kept in step with the sending, and the first time a send
 * failed halfway they would disagree — after which nobody can tell whether the
 * customer was chased twice or not at all.
 *
 * **One reminder per stage, ever.** A retry after a bounced message must not
 * become a second reminder, and a job that runs twice in a day must not chase
 * twice. So a stage that has been sent is closed, whatever happened next.
 *
 * **A credit note is never chased.** Nor is anything already cancelled. The
 * filter belongs here rather than in a query, because it is a rule.
 */

export interface DunningStage {
  /** 1, 2, 3… in order. */
  readonly stage: number
  /** Days after the due date at which this reminder becomes due. */
  readonly afterDays: number
  /** What the message is called, and how it reads. */
  readonly label: string
  readonly tone: 'reminder' | 'demand' | 'final'
}

/**
 * The default schedule.
 *
 * Dutch practice for a B2B invoice, and deliberately unaggressive: a first
 * reminder a week after the due date reads as a courtesy, which is what it
 * usually is — most late invoices are late because somebody forgot.
 *
 * Fourteen days after the final notice a creditor may charge statutory
 * interest and collection costs (WIK), which is a decision for a human, so the
 * schedule stops at three and says so.
 */
export const DEFAULT_DUNNING_SCHEDULE: readonly DunningStage[] = [
  { stage: 1, afterDays: 7, label: 'Betalingsherinnering', tone: 'reminder' },
  { stage: 2, afterDays: 21, label: 'Tweede herinnering', tone: 'demand' },
  { stage: 3, afterDays: 42, label: 'Laatste aanmaning', tone: 'final' },
]

export interface DunnableInvoice {
  readonly invoiceId: string
  readonly number: string
  readonly kind: 'invoice' | 'credit_note'
  readonly status: 'draft' | 'issued' | 'cancelled'
  readonly dueDate: string
  readonly total: bigint
  readonly currency: string
  readonly contactName: string
  readonly contactEmail: string | null
  /** Stages already sent, in any order. */
  readonly remindersSent: readonly number[]
}

export interface DunningAction {
  readonly invoiceId: string
  readonly number: string
  readonly contactName: string
  readonly contactEmail: string | null
  readonly total: bigint
  readonly currency: string
  readonly dueDate: string
  readonly daysOverdue: number
  readonly stage: DunningStage
  /**
   * False when there is no address to send to. Listed anyway: "I chased them
   * and nothing happened" is the case where hiding the row is least helpful.
   */
  readonly sendable: boolean
}

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/**
 * What to send today, and to whom.
 *
 * At most one action per invoice: the highest stage that has come due and has
 * not been sent. Sending three reminders at once because an invoice was
 * forgotten for two months is not chasing, it is spamming.
 */
export function planDunning(
  invoices: readonly DunnableInvoice[],
  asOf: string,
  schedule: readonly DunningStage[] = DEFAULT_DUNNING_SCHEDULE,
): readonly DunningAction[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new LedgerError([violation('invalid_date.date_yyyy_mm', 'asOf')])
  }

  const ordered = [...schedule].sort((a, b) => a.afterDays - b.afterDays)
  const actions: DunningAction[] = []

  for (const invoice of invoices) {
    // A credit note is money owed *to* the customer, and a cancelled invoice is
    // owed by nobody.
    if (invoice.kind !== 'invoice' || invoice.status !== 'issued') continue

    const daysOverdue = daysBetween(invoice.dueDate, asOf)
    if (daysOverdue <= 0) continue

    /**
     * Only stages *above* the highest already sent are candidates.
     *
     * Not "any unsent stage": once a final demand has gone out, following it
     * with a polite second reminder is nonsense, and that is what a
     * set-difference would do if a stage were ever missed.
     */
    const highestSent = invoice.remindersSent.reduce(
      (highest, stage) => Math.max(highest, stage),
      0,
    )
    const due = ordered.filter(
      (stage) => stage.stage > highestSent && daysOverdue >= stage.afterDays,
    )

    /**
     * The **highest** stage that has come due, not the next one up.
     *
     * An invoice two months late that nobody ever chased gets the final demand
     * rather than a courtesy reminder: the schedule already says what forty-two
     * days late deserves, and walking up from stage one would send three
     * letters in three days.
     */
    const next = due.at(-1)
    if (next === undefined) continue

    actions.push({
      invoiceId: invoice.invoiceId,
      number: invoice.number,
      contactName: invoice.contactName,
      contactEmail: invoice.contactEmail,
      total: invoice.total,
      currency: invoice.currency,
      dueDate: invoice.dueDate,
      daysOverdue,
      stage: next,
      sendable: invoice.contactEmail !== null && invoice.contactEmail !== '',
    })
  }

  // Longest overdue first: that is the order somebody working through the list
  // wants, and the order a report should read in.
  return actions.sort((a, b) => b.daysOverdue - a.daysOverdue)
}

/** The stage a given reminder number is, or null if the schedule has no such stage. */
export function stageOf(
  stage: number,
  schedule: readonly DunningStage[] = DEFAULT_DUNNING_SCHEDULE,
): DunningStage | null {
  return schedule.find((item) => item.stage === stage) ?? null
}
