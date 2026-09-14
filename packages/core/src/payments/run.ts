import { LedgerError, forwarded, type LedgerViolation } from '../errors.js'
import { formatMinorUnits } from '../format/index.js'
import { isValidIban } from './model.js'

/**
 * Turning approved purchase invoices into payment instructions (spec 15, M4).
 *
 * This is the step that closes the cycle: a document arrives, becomes an
 * invoice, gets authorised, and now becomes money leaving the building.
 *
 * ## One instruction per supplier, not per invoice
 *
 * The tempting design is one payment per invoice, so each carries its own
 * betalingskenmerk and the supplier's reconciliation is automatic. **Credit
 * notes make it impossible.** A supplier who invoiced 1.210,00 and then credited
 * 210,00 is owed 1.000,00, and there is no such thing as a payment of minus
 * 210,00 — the credit has to be netted against something before any money
 * moves.
 *
 * So the unit is the supplier, the amount is what they are net owed, and the
 * instruction records which documents it settles. That is what
 * `payment_instruction_invoices` exists for, and it is what lets a returned
 * payment be traced back to the invoices it was meant to clear.
 *
 * The structured reference survives the common case: when a supplier is owed for
 * exactly one invoice and that invoice carries a payment reference, it goes out
 * as the structured remittance and their system reconciles it automatically.
 * When several documents are settled at once there is nowhere to put more than
 * one, so the numbers are listed unstructured — which is what a supplier
 * statement run looks like everywhere else too.
 *
 * ## What is refused, and when
 *
 * A batch that cannot be paid is refused *here*, while it is still a list on a
 * screen, rather than by the bank three days later. `validatePaymentBatch`
 * checks the file; this checks the selection.
 */

/** SEPA's unstructured remittance field. Longer is silently truncated by banks. */
const REMITTANCE_LIMIT = 140

export interface PayableItem {
  readonly invoiceId: string
  readonly supplierInvoiceNumber: string
  readonly kind: 'invoice' | 'credit_note'
  readonly dueDate: string
  /** What is still outstanding, unsigned. */
  readonly outstandingMinorUnits: bigint
  readonly paymentReference: string | null
  readonly currency: string
}

export interface PayableSupplier {
  readonly contactId: string
  readonly contactNumber: string
  readonly contactName: string
  readonly iban: string | null
  readonly bic: string | null
  readonly items: readonly PayableItem[]
}

export interface PlannedAllocation {
  readonly invoiceId: string
  readonly supplierInvoiceNumber: string
  readonly kind: 'invoice' | 'credit_note'
  /**
   * Unsigned, per document. The instruction's amount is the invoices less the
   * credit notes; each document records what this instruction settled of it.
   */
  readonly amountMinorUnits: bigint
}

export interface PlannedInstruction {
  readonly contactId: string
  readonly contactNumber: string
  readonly creditorName: string
  readonly creditorIban: string
  readonly creditorBic: string | null
  readonly amountMinorUnits: bigint
  readonly currency: string
  readonly remittanceInformation: string
  readonly remittanceReference: string | null
  readonly endToEndId: string
  readonly allocations: readonly PlannedAllocation[]
  /** The earliest due date among the documents settled. For sorting a run. */
  readonly dueDate: string
}

export type PaymentRunFindingCode =
  'no_iban' | 'invalid_iban' | 'nothing_owed' | 'credit_exceeds_invoices' | 'mixed_currencies'

export interface PaymentRunFinding {
  readonly code: PaymentRunFindingCode
  readonly severity: 'blocking' | 'note'
  readonly contactNumber: string
  readonly message: string
  readonly amountMinorUnits: bigint
}

export interface PaymentRunPlan {
  readonly instructions: readonly PlannedInstruction[]
  readonly findings: readonly PaymentRunFinding[]
  readonly totalMinorUnits: bigint
}

export interface PaymentRunRequest {
  readonly suppliers: readonly PayableSupplier[]
  /** The batch's own currency. A document in another one cannot join it. */
  readonly currency: string
  /** `BATCH-2026-04-01`, used to build a unique end-to-end id per instruction. */
  readonly batchReference: string
}

function money(minorUnits: bigint): string {
  return formatMinorUnits(minorUnits)
}

/**
 * A stable, unique reference per instruction.
 *
 * A bank may read two identical end-to-end ids as one duplicated payment, so it
 * has to be unique within the batch — and stable, so building the same run
 * twice does not produce two payments the bank cannot tell apart.
 */
function endToEndIdFor(batchReference: string, contactNumber: string): string {
  // 35 characters, SEPA's limit, and only the characters it accepts.
  const cleaned = `${batchReference}-${contactNumber}`
    .toUpperCase()
    .replace(/[^A-Z0-9/?:().,'+ -]/g, '-')
  return cleaned.slice(0, 35)
}

/**
 * What to pay each supplier, netting their credit notes.
 *
 * Oldest first, because a credit note reduces the oldest thing outstanding
 * unless somebody says otherwise — which is both the convention and the answer
 * that keeps the ageing honest.
 */
export function planPaymentRun(request: PaymentRunRequest): PaymentRunPlan {
  const instructions: PlannedInstruction[] = []
  const findings: PaymentRunFinding[] = []

  const flag = (
    code: PaymentRunFindingCode,
    severity: 'blocking' | 'note',
    contactNumber: string,
    message: string,
    amountMinorUnits = 0n,
  ): void => {
    findings.push({ code, severity, contactNumber, message, amountMinorUnits })
  }

  for (const supplier of request.suppliers) {
    const wrongCurrency = supplier.items.filter((item) => item.currency !== request.currency)
    if (wrongCurrency.length > 0) {
      flag(
        'mixed_currencies',
        'blocking',
        supplier.contactNumber,
        `${supplier.contactName} has ${String(wrongCurrency.length)} open document(s) in another currency than the batch's ${request.currency}. A pain.001 batch carries one currency; put those in their own run.`,
      )
      continue
    }

    // Oldest first, so a credit note lands on the oldest invoice.
    const ordered = [...supplier.items].sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        a.supplierInvoiceNumber.localeCompare(b.supplierInvoiceNumber),
    )
    const invoices = ordered.filter((item) => item.kind === 'invoice')
    const credits = ordered.filter((item) => item.kind === 'credit_note')

    const owed = invoices.reduce((sum, item) => sum + item.outstandingMinorUnits, 0n)
    const credited = credits.reduce((sum, item) => sum + item.outstandingMinorUnits, 0n)
    const net = owed - credited

    if (net === 0n) {
      flag(
        'nothing_owed',
        'note',
        supplier.contactNumber,
        `${supplier.contactName}'s open invoices and credit notes cancel out exactly. Nothing to pay, and nothing wrong.`,
      )
      continue
    }
    if (net < 0n) {
      // A payment of minus anything is not a thing. The supplier owes us, which
      // is a refund to ask for rather than a transfer to send.
      flag(
        'credit_exceeds_invoices',
        'note',
        supplier.contactNumber,
        `${supplier.contactName} has ${money(-net)} more credited than invoiced. That is a refund to ask them for, not a payment to send.`,
        -net,
      )
      continue
    }

    if (supplier.iban === null || supplier.iban.trim() === '') {
      flag(
        'no_iban',
        'blocking',
        supplier.contactNumber,
        `${supplier.contactName} is owed ${money(net)} and has no IBAN on file. Add it under Relaties.`,
        net,
      )
      continue
    }
    if (!isValidIban(supplier.iban)) {
      // Caught here rather than by the bank, which refuses the whole batch for
      // one bad account and does not say which.
      flag(
        'invalid_iban',
        'blocking',
        supplier.contactNumber,
        `${supplier.contactName}'s IBAN does not pass its own check digits. A mistyped IBAN gets the whole batch refused.`,
        net,
      )
      continue
    }

    // Every document in the net is settled by this instruction: the invoices in
    // full, the credit notes in full, and the difference is the cash. That is
    // what `net > 0` means — the credits fit inside the invoices.
    //
    // The tempting alternative, spending the cash across the invoices oldest
    // first and leaving the rest, silently overpays: a credit of 150,00 against
    // two invoices of 100,00 would mark the first settled and leave the second
    // to be paid in full next week, so 250,00 goes out on 200,00 invoiced.
    const allocations: PlannedAllocation[] = [
      ...invoices.map((invoice) => ({
        invoiceId: invoice.invoiceId,
        supplierInvoiceNumber: invoice.supplierInvoiceNumber,
        kind: 'invoice' as const,
        amountMinorUnits: invoice.outstandingMinorUnits,
      })),
      ...credits.map((credit) => ({
        invoiceId: credit.invoiceId,
        supplierInvoiceNumber: credit.supplierInvoiceNumber,
        kind: 'credit_note' as const,
        amountMinorUnits: credit.outstandingMinorUnits,
      })),
    ]

    const settled = [...invoices, ...credits]
    const singleInvoice = invoices.length === 1 && credits.length === 0

    const numbers = settled.map((item) => item.supplierInvoiceNumber).join(', ')
    const remittance =
      numbers.length > REMITTANCE_LIMIT ? `${numbers.slice(0, REMITTANCE_LIMIT - 1)}…` : numbers

    instructions.push({
      contactId: supplier.contactId,
      contactNumber: supplier.contactNumber,
      creditorName: supplier.contactName,
      creditorIban: supplier.iban.replace(/\s/g, '').toUpperCase(),
      creditorBic: supplier.bic,
      amountMinorUnits: net,
      currency: request.currency,
      remittanceInformation: remittance,
      // A structured reference carries exactly one value, so it only survives
      // when exactly one document is being settled. Otherwise the numbers go
      // out unstructured, which is what a statement run looks like anyway.
      remittanceReference: singleInvoice ? (invoices[0]?.paymentReference ?? null) : null,
      endToEndId: endToEndIdFor(request.batchReference, supplier.contactNumber),
      allocations,
      dueDate: ordered[0]?.dueDate ?? '',
    })
  }

  instructions.sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.contactNumber.localeCompare(b.contactNumber),
  )

  const order = { blocking: 0, note: 1 } as const
  findings.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] || a.contactNumber.localeCompare(b.contactNumber),
  )

  return {
    instructions,
    findings,
    totalMinorUnits: instructions.reduce((sum, entry) => sum + entry.amountMinorUnits, 0n),
  }
}

/**
 * Refuse a run that cannot go out.
 *
 * Blocking findings only. A supplier whose credits exceed their invoices is not
 * a problem with the run — it is a fact about that supplier, and the rest of the
 * batch is still payable.
 */
export function assertRunnable(plan: PaymentRunPlan): void {
  const blocking = plan.findings.filter((finding) => finding.severity === 'blocking')
  if (blocking.length === 0) return

  const problems: LedgerViolation[] = blocking.map((finding) =>
    forwarded('invalid_payment', `suppliers.${finding.contactNumber}`, finding.message, {
      code: finding.code,
      amount: finding.amountMinorUnits.toString(),
    }),
  )
  throw new LedgerError(problems)
}
