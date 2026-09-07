import { violation, LedgerError } from '../errors.js'
import type { JournalLineInput, PostJournalEntryCommand } from '../ledger/types.js'

/**
 * A matched bank line, as a journal entry.
 *
 * Banking does not write to the journal either. It builds a command and hands
 * it to `postJournalEntry`, exactly as sales does and exactly as a script over
 * the REST API would (spec 9.1) — so period control, the hash chain, the audit
 * row and the outbox event all apply to a bank match without banking knowing
 * they exist.
 *
 * The shape of a customer payment that arrived a few euro short:
 *
 *     Bank                  1.206,50 D
 *     Bankkosten                3,50 D
 *       Debiteuren                       1.210,00 C   (carrying the subledger link)
 *
 * And of a direct debit for a phone bill:
 *
 *     Telefoonkosten           45,50 D
 *       Bank                              45,50 C
 *
 * One rule holds both together: **the bank side is the transaction, exactly.**
 * Whatever the bank says moved is what moves on the bank account, and the other
 * side is what the human decided it was for. Anything left over after the
 * allocations is an error rather than a rounding, and it is refused.
 */

export interface BankMatchAllocation {
  readonly invoiceId: string
  readonly invoiceNumber: string
  /** Signed like the transaction. What this invoice absorbs. */
  readonly amount: bigint
  readonly contactNumber: string
  readonly contactName: string
  readonly contactId: string
}

export interface BankMatchRequest {
  readonly entityId: string
  readonly journalCode: string
  readonly bookingDate: string
  readonly valueDate: string
  /** The ledger account the bank account posts to. */
  readonly bankAccountNumber: string
  /** Signed minor units. Positive is money in. */
  readonly amount: bigint
  readonly currency: string
  readonly counterpartyName: string | null
  readonly description: string
  /** The control account the allocations clear: debiteuren, or crediteuren. */
  readonly receivableAccountNumber: string
  readonly allocations: readonly BankMatchAllocation[]
  /** Where anything not allocated goes. Required when there is a remainder. */
  readonly remainderAccountNumber: string | null
  /** Charges the bank deducted. Settled against `chargesAccountNumber`. */
  readonly chargesAmount: bigint
  readonly chargesAccountNumber: string | null
}

function line(
  accountNumber: string,
  amount: bigint,
  isDebit: boolean,
  description: string,
  extra: Partial<JournalLineInput> = {},
): JournalLineInput {
  return {
    accountNumber,
    description,
    debit: isDebit ? amount : 0n,
    credit: isDebit ? 0n : amount,
    currency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    taxCode: null,
    taxRole: null,
    taxAmount: null,
    dimensions: [],
    subledgerKind: null,
    subledgerId: null,
    ...extra,
  }
}

export function buildBankMatchEntry(request: BankMatchRequest): PostJournalEntryCommand {
  const violations = []

  if (request.amount === 0n) {
    violations.push(violation('line_no_amount', 'amount', 'A bank line of zero posts nothing.'))
  }
  if (request.chargesAmount < 0n) {
    violations.push(
      violation('line_negative_amount', 'chargesAmount', 'Charges cannot be negative.'),
    )
  }
  if (request.chargesAmount > 0n && request.chargesAccountNumber === null) {
    violations.push(
      violation('unknown_account', 'chargesAccountNumber', 'Charges need an account to post to.'),
    )
  }

  const incoming = request.amount > 0n
  const magnitude = incoming ? request.amount : -request.amount

  const allocated = request.allocations.reduce(
    (sum, allocation) => sum + (allocation.amount < 0n ? -allocation.amount : allocation.amount),
    0n,
  )

  for (const allocation of request.allocations) {
    // An allocation pointing the other way would clear an invoice with money
    // that went in the opposite direction, which is never what happened.
    if (allocation.amount === 0n || allocation.amount < 0n === incoming) {
      violations.push(
        violation(
          'line_negative_amount',
          'allocations',
          `The allocation to ${allocation.invoiceNumber} does not point the same way as the payment.`,
        ),
      )
    }
  }

  /**
   * What the allocations plus the charges leave over.
   *
   * Charges are money the bank kept, so they *add* to what the invoice
   * absorbed: 1206.50 received plus 3.50 charges settles a 1210.00 invoice.
   */
  const remainder = magnitude + request.chargesAmount - allocated

  if (remainder < 0n) {
    violations.push(
      violation(
        'entry_unbalanced',
        'allocations',
        `The allocations come to ${allocated.toString()}, which is more than the ` +
          `${(magnitude + request.chargesAmount).toString()} this line accounts for.`,
      ),
    )
  }
  if (remainder > 0n && request.remainderAccountNumber === null) {
    violations.push(
      violation(
        'unknown_account',
        'remainderAccountNumber',
        `${remainder.toString()} is not accounted for. Say which account it belongs to.`,
      ),
    )
  }

  if (violations.length > 0) throw new LedgerError(violations)

  const lines: JournalLineInput[] = [
    // The bank side is the transaction, exactly.
    line(
      request.bankAccountNumber,
      magnitude,
      incoming,
      request.counterpartyName ?? request.description.slice(0, 120) ?? 'Bankmutatie',
    ),
  ]

  if (request.chargesAmount > 0n && request.chargesAccountNumber !== null) {
    // Charges are a cost whichever way the money went: on a receipt they are
    // the shortfall, on a payment they are on top.
    lines.push(line(request.chargesAccountNumber, request.chargesAmount, true, 'Bankkosten'))
  }

  // The control account, one line per invoice so the subledger link is exact
  // and the debtors ledger shows the payment against the right document.
  for (const allocation of request.allocations) {
    const amount = allocation.amount < 0n ? -allocation.amount : allocation.amount
    lines.push(
      line(
        request.receivableAccountNumber,
        amount,
        !incoming,
        `${allocation.contactNumber} ${allocation.contactName} · ${allocation.invoiceNumber}`,
        { subledgerKind: 'customer', subledgerId: allocation.contactId },
      ),
    )
  }

  if (remainder > 0n && request.remainderAccountNumber !== null) {
    lines.push(
      line(
        request.remainderAccountNumber,
        remainder,
        !incoming,
        request.description === '' ? 'Bankmutatie' : request.description.slice(0, 120),
      ),
    )
  }

  const reference =
    request.allocations.length > 0
      ? request.allocations.map((allocation) => allocation.invoiceNumber).join(', ')
      : null

  return {
    entityId: request.entityId,
    journalCode: request.journalCode,
    bookingDate: request.bookingDate,
    documentDate: request.valueDate,
    description:
      request.allocations.length > 0
        ? `Betaling ${reference ?? ''}`.trim()
        : request.description === ''
          ? (request.counterpartyName ?? 'Bankmutatie')
          : request.description.slice(0, 200),
    sourceDocumentRef: reference,
    reversesEntryId: null,
    lines,
  }
}
