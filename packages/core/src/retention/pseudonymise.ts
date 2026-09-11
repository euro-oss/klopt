/**
 * Erasing a contact without falsifying the books (spec 7.6).
 *
 * A right-to-erasure request cannot remove a posted invoice: article 17(3)(b)
 * GDPR excepts processing needed to comply with a legal obligation, and the
 * bewaarplicht is one. But that exception covers the *invoice*, not everything
 * the administration happens to know about the person. A phone number, an
 * email address, a note somebody typed, the bank account they last paid from
 * — none of those are on the invoice and none are needed to keep it readable.
 *
 * So the split is between the transaction and the address book:
 *
 * - The **invoice** carries its own copy of who it was for, taken at issue
 *   (migration 0026). That copy is what the bewaarplicht protects and it is
 *   never touched here.
 * - The **contact** is current master data — who we bill today. That is what
 *   an erasure request is about, and it is what this erases.
 *
 * What survives on the contact is only what the ledger itself refers to: the
 * debiteurennummer, because it travels into the XAF and identifies the
 * subledger account the postings sit on. Erasing that would not anonymise
 * anybody, it would break the join between an invoice and its own history.
 *
 * Nothing here is legal advice. It is the position this codebase takes,
 * written down so it can be argued with — see ADR 0030.
 */

/** What the contact keeps, in the caller's words, for the confirmation screen. */
export const PSEUDONYMISED_FIELDS = [
  'name',
  'legalName',
  'email',
  'phone',
  'iban',
  'notes',
  'electronicAddress',
  'address',
] as const

export interface PseudonymisationSubject {
  readonly number: string
  readonly kind: 'company' | 'person'
  /** Sales invoices not yet settled. */
  readonly openSales: number
  /** Purchase invoices not yet settled. */
  readonly openPurchases: number
}

export type PseudonymisationRefusal = { readonly code: 'has_open_items'; readonly open: number }

/**
 * The replacement name.
 *
 * Not an empty string and not `null`: the column is `not null`, every screen
 * that lists contacts would render a blank row, and a blank row reads as a
 * bug rather than as a decision somebody took. Naming the debiteurennummer
 * keeps the row identifiable *as a ledger account* — which is the one thing
 * it still legitimately is — without naming a person.
 */
export function pseudonymOf(number: string): string {
  return `Gewist contact ${number}`
}

/**
 * Whether this contact can be erased now.
 *
 * Refused while money is outstanding in either direction. Collecting a debt is
 * a legitimate interest that keeps the ground for processing alive, and more
 * practically: dunning needs an address to send to, so erasing it mid-chase
 * produces a receivable nobody can pursue and a screen that cannot say why.
 * Settle or write off first, then erase — and the refusal says exactly that.
 *
 * Deliberately *not* conditioned on the retention term. The seven years
 * protect the invoice, and the invoice keeps its own copy; there is no ground
 * for holding a phone number for seven years because an invoice exists.
 */
export function refusePseudonymisation(
  subject: PseudonymisationSubject,
): PseudonymisationRefusal | null {
  const open = subject.openSales + subject.openPurchases
  return open > 0 ? { code: 'has_open_items', open } : null
}
