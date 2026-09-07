import { violation, LedgerError } from '../errors.js'
import type { JournalLineInput, PostJournalEntryCommand } from '../ledger/types.js'
import { recoverableBasisPoints, type TaxCodeRule } from '../vat/tax-code.js'
import { selfAssesses, type PurchaseInvoiceInput } from './check.js'

/**
 * A purchase invoice, as a journal entry.
 *
 * The mirror of `sales/posting.ts` — it builds a command and hands it to
 * `postJournalEntry` like anything else, so the balance check, the period
 * control, the hash chain and the audit row apply for free.
 *
 * The shape of an ordinary Dutch purchase posting:
 *
 *     Kantoorkosten          100,00 D    (the base, tagged with our tax code)
 *     Te vorderen BTW         21,00 D    (voorbelasting)
 *       Crediteuren                      121,00 C   (gross, with the subledger link)
 *
 * Three things make it more than sales with the signs flipped.
 *
 * **The amounts come from the document.** `check.ts` has already established
 * that the capture is faithful; this posts what was captured. It never
 * recomputes a VAT figure the supplier stated.
 *
 * **Deductibility decides where the VAT goes.** M3's tax code rule says whether
 * input VAT is fully recoverable, partly, or not at all, and the non-recoverable
 * part is not VAT any more — it is cost. So it goes to the expense account, on
 * its own line, next to the base rather than folded into it. Two lines on one
 * account is what the base/tax tagging from ADR 0021 made possible, and it is
 * what keeps the auditfile honest about which euros were the base and which
 * were VAT that turned into a cost.
 *
 * **A reverse charge posts VAT the supplier never charged.** Under an
 * intra-community acquisition or article 23 deferment the invoice carries no
 * VAT and we owe it ourselves, so the entry credits the payable account and
 * debits the receivable one — with two different tax codes, because rubriek 4b
 * and rubriek 5b are two declarations of the same money and the return is
 * derived from the journal. That is what `deductionCode` on the rule is for.
 */

export interface PurchasePostingRequest {
  readonly entityId: string
  readonly journalCode: string
  readonly bookingDate: string
  readonly contactNumber: string
  readonly contactName: string
  readonly contactId: string
  /** The control account: crediteuren. */
  readonly payableAccountNumber: string
  readonly invoice: PurchaseInvoiceInput
}

/** Where a tax code's VAT is booked. Resolved by the caller from the chart. */
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
    taxRole: null,
    taxAmount: null,
    dimensions: [],
    subledgerKind: null,
    subledgerId: null,
    ...extra,
  }
}

function ruleFor(
  rules: readonly TaxCodeRule[],
  code: string,
  onDate: string,
): TaxCodeRule | undefined {
  return rules.find(
    (rule) =>
      rule.code === code &&
      rule.validFrom <= onDate &&
      (rule.validTo === null || rule.validTo >= onDate),
  )
}

export function buildPurchaseEntry(
  request: PurchasePostingRequest,
  rules: readonly TaxCodeRule[],
  taxAccountFor: TaxAccountResolver,
): PostJournalEntryCommand {
  const { invoice } = request

  if (invoice.totalMinorUnits === 0n && invoice.netMinorUnits === 0n) {
    throw new LedgerError([
      violation('line_no_amount', 'lines', 'An invoice totalling zero posts nothing.'),
    ])
  }

  // A credit note reverses every side. Computed once rather than branched on
  // per line, so the two documents cannot drift apart.
  const payableIsCredit = invoice.kind === 'invoice'
  const lines: JournalLineInput[] = []

  /**
   * Costs, collapsed per account *and* tax code.
   *
   * Per account because ten stationery lines are one journal line to a
   * bookkeeper. Per tax code as well because rubriek 5b is derived from the
   * journal, and two rates on one expense account collapsed together are two
   * deductions nothing downstream can separate. Same reasoning as ADR 0021.
   */
  const costs = new Map<
    string,
    {
      accountNumber: string
      taxCode: string
      net: bigint
      /** The VAT that will actually be deducted for this group. */
      deductible: bigint
      /** VAT that is not recoverable and has therefore become cost. */
      sunk: bigint
      /** The VAT we owe ourselves, when we self-assess it. */
      selfAssessed: bigint
      rule: TaxCodeRule
    }
  >()

  for (const item of invoice.lines) {
    const rule = ruleFor(rules, item.taxCode, invoice.invoiceDate)
    if (rule === undefined) {
      throw new LedgerError([
        violation(
          'invalid_tax_code',
          `lines.${item.taxCode}`,
          `Tax code ${item.taxCode} has no rule valid on ${invoice.invoiceDate}. This should have been caught before posting.`,
        ),
      ])
    }

    // Under a reverse charge the supplier charged nothing, so the VAT to
    // account for is ours to compute. Everywhere else it is theirs to state.
    const charged = selfAssesses(rule)
      ? (item.netMinorUnits * BigInt(rule.rateBasisPoints)) / 10_000n
      : item.taxMinorUnits

    const recoverable = BigInt(recoverableBasisPoints(rule))
    const deductible = (charged * recoverable) / 10_000n

    const key = `${item.accountNumber}\u0000${item.taxCode}`
    const found = costs.get(key)
    if (found === undefined) {
      costs.set(key, {
        accountNumber: item.accountNumber,
        taxCode: item.taxCode,
        net: item.netMinorUnits,
        deductible,
        sunk: charged - deductible,
        selfAssessed: selfAssesses(rule) ? charged : 0n,
        rule,
      })
    } else {
      found.net += item.netMinorUnits
      found.deductible += deductible
      found.sunk += charged - deductible
      found.selfAssessed += selfAssesses(rule) ? charged : 0n
    }
  }

  const groups = [...costs.values()].sort(
    (a, b) => a.accountNumber.localeCompare(b.accountNumber) || a.taxCode.localeCompare(b.taxCode),
  )

  for (const group of groups) {
    if (group.net !== 0n) {
      lines.push(
        line(
          group.accountNumber,
          group.net,
          payableIsCredit,
          `${invoice.supplierInvoiceNumber} ${request.contactName}`,
          {
            // The taxable base. Tagged so the return and the auditfile can find
            // it, with the VAT actually deducted alongside.
            taxCode: group.taxCode,
            taxRole: 'base',
            taxAmount: payableIsCredit ? group.deductible : -group.deductible,
          },
        ),
      )
    }

    // VAT that cannot be reclaimed is cost, and it says so on its own line
    // rather than hiding inside the base. Untagged: it is not voorbelasting
    // and must not reach rubriek 5b.
    if (group.sunk !== 0n) {
      lines.push(
        line(
          group.accountNumber,
          group.sunk,
          payableIsCredit,
          `Niet-aftrekbare BTW ${group.taxCode} ${invoice.supplierInvoiceNumber}`,
        ),
      )
    }
  }

  // The VAT we owe ourselves, under a reverse charge. Credited to the payable
  // control account under the acquisition code, which puts it in 4b or 2a.
  for (const group of groups) {
    if (group.selfAssessed === 0n) continue
    const accountNumber = taxAccountFor(group.taxCode)
    if (accountNumber === null) {
      throw new LedgerError([
        violation(
          'unknown_account',
          `taxCodes.${group.taxCode}`,
          `Tax code ${group.taxCode} has no ledger account. Set one before booking with it.`,
        ),
      ])
    }
    lines.push(
      line(
        accountNumber,
        group.selfAssessed,
        !payableIsCredit,
        `${group.taxCode} verlegd over ${invoice.supplierInvoiceNumber}`,
        {
          taxCode: group.taxCode,
          taxRole: 'tax',
          taxAmount: payableIsCredit ? -group.selfAssessed : group.selfAssessed,
        },
      ),
    )
  }

  // The voorbelasting. Under a reverse charge it goes out under the *paired*
  // deduction code, because the acquisition code already declared the same
  // money as owed and one code cannot mean both.
  for (const group of groups) {
    if (group.deductible === 0n) continue

    const deductionCode = group.selfAssessed === 0n ? group.taxCode : group.rule.deductionCode
    if (deductionCode === null) {
      throw new LedgerError([
        violation(
          'invalid_tax_code',
          `taxCodes.${group.taxCode}`,
          `${group.taxCode} self-assesses its VAT but names no deduction code, so the voorbelasting side has nowhere to go. Set deductionCode on it.`,
        ),
      ])
    }

    const accountNumber = taxAccountFor(deductionCode)
    if (accountNumber === null) {
      throw new LedgerError([
        violation(
          'unknown_account',
          `taxCodes.${deductionCode}`,
          `Tax code ${deductionCode} has no ledger account. Set one before booking with it.`,
        ),
      ])
    }

    lines.push(
      line(
        accountNumber,
        group.deductible,
        payableIsCredit,
        `${deductionCode} over ${invoice.supplierInvoiceNumber}`,
        {
          taxCode: deductionCode,
          taxRole: 'tax',
          taxAmount: payableIsCredit ? group.deductible : -group.deductible,
        },
      ),
    )
  }

  lines.push(
    line(
      request.payableAccountNumber,
      invoice.totalMinorUnits,
      !payableIsCredit,
      `${request.contactNumber} ${request.contactName} ${invoice.supplierInvoiceNumber}`,
      {
        // The subledger link. What makes the creditors ledger, the ageing
        // report and the payment run possible.
        subledgerKind: 'supplier',
        subledgerId: request.contactId,
      },
    ),
  )

  return {
    entityId: request.entityId,
    journalCode: request.journalCode,
    bookingDate: request.bookingDate,
    documentDate: invoice.invoiceDate,
    description: `${invoice.kind === 'credit_note' ? 'Creditnota' : 'Inkoopfactuur'} ${invoice.supplierInvoiceNumber} ${request.contactName}`,
    sourceDocumentRef: invoice.supplierInvoiceNumber,
    reversesEntryId: null,
    lines,
  }
}
