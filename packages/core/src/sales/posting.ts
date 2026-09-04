import { violation, LedgerError } from '../errors.js'
import { toWire } from '../money.js'
import type { JournalLineInput, PostJournalEntryCommand } from '../ledger/types.js'
import type { PricedInvoice } from './pricing.js'

/**
 * An invoice, as a journal entry.
 *
 * Sales does not write to the journal. It builds a command and hands it to
 * `postJournalEntry`, exactly as a script over the REST API would — which is
 * what spec 9.1 means by one posting API, and what makes the module contract in
 * 9.5 real rather than aspirational. Everything the ledger guarantees (balance,
 * period control, gapless numbering, the hash chain, the audit row, the outbox
 * event) therefore applies to an invoice for free.
 *
 * The shape of a Dutch sales invoice posting:
 *
 *     Debiteuren            1.210,00 D    (gross, carrying the subledger link)
 *       Omzet                          1.000,00 C   (net, per revenue account)
 *       Te betalen BTW                   210,00 C   (per tax code)
 *
 * A credit note is the same entry with the sides swapped.
 */

export interface InvoicePostingRequest {
  readonly entityId: string
  readonly journalCode: string
  readonly bookingDate: string
  readonly documentDate: string
  readonly invoiceNumber: string
  readonly contactNumber: string
  readonly contactName: string
  readonly contactId: string
  /** The control account: debiteuren. */
  readonly receivableAccountNumber: string
  readonly isCreditNote: boolean
  readonly reference: string | null
  readonly currency: string
}

/**
 * Tax codes need an account before an invoice using them can be posted. A
 * missing one is a configuration error, and it is worth saying which code.
 */
export interface TaxAccountResolver {
  (taxCode: string): string | null
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
    taxAmount: null,
    dimensions: [],
    subledgerKind: null,
    subledgerId: null,
    ...extra,
  }
}

export function buildInvoiceEntry(
  request: InvoicePostingRequest,
  priced: PricedInvoice,
  taxAccountFor: TaxAccountResolver,
): PostJournalEntryCommand {
  if (priced.total === 0n) {
    throw new LedgerError([
      violation('line_no_amount', 'lines', 'An invoice totalling zero posts nothing.'),
    ])
  }

  // A credit note reverses every side. Computed once rather than branched on
  // per line, so the two documents cannot drift apart.
  const receivableIsDebit = !request.isCreditNote

  const lines: JournalLineInput[] = [
    line(
      request.receivableAccountNumber,
      priced.total,
      receivableIsDebit,
      `${request.contactNumber} ${request.contactName}`,
      {
        // The subledger link. This is what makes the debtors ledger, the ageing
        // report and — in M2 — bank matching possible (spec 6.5).
        subledgerKind: 'customer',
        subledgerId: request.contactId,
      },
    ),
  ]

  // Revenue, collapsed per account: an invoice with ten lines on one account is
  // one journal line, which is what a bookkeeper expects to see.
  const revenue = new Map<string, bigint>()
  for (const item of priced.lines) {
    revenue.set(
      item.revenueAccountNumber,
      (revenue.get(item.revenueAccountNumber) ?? 0n) + item.net,
    )
  }

  for (const [accountNumber, amount] of [...revenue].sort(([a], [b]) => a.localeCompare(b))) {
    if (amount === 0n) continue
    lines.push(
      line(accountNumber, amount, !receivableIsDebit, `Omzet factuur ${request.invoiceNumber}`),
    )
  }

  for (const group of priced.taxGroups) {
    if (group.amount === 0n) continue

    const accountNumber = taxAccountFor(group.tax.code)
    if (accountNumber === null) {
      throw new LedgerError([
        violation(
          'unknown_account',
          `taxCodes.${group.tax.code}`,
          `Tax code ${group.tax.code} has no ledger account. Set one before invoicing with it.`,
          { taxCode: group.tax.code },
        ),
      ])
    }

    lines.push(
      line(
        accountNumber,
        group.amount,
        !receivableIsDebit,
        // Through the money codec, not `Number(x) / 100`: a float has no
        // business in a description that ends up in an auditfile either.
        `${group.tax.code} over ${toWire({ minorUnits: group.net, currency: request.currency }).amount}`,
        { taxCode: group.tax.code, taxAmount: receivableIsDebit ? group.amount : -group.amount },
      ),
    )
  }

  return {
    entityId: request.entityId,
    journalCode: request.journalCode,
    bookingDate: request.bookingDate,
    documentDate: request.documentDate,
    description: `${request.isCreditNote ? 'Creditnota' : 'Verkoopfactuur'} ${request.invoiceNumber} ${request.contactName}`,
    sourceDocumentRef: request.invoiceNumber,
    reversesEntryId: null,
    lines,
  }
}
