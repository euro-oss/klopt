/**
 * Which accounts and dagboeken a migration may be booked to.
 *
 * Pulled out of the Exact screen so the rule is testable without a browser and
 * a live Exact connection: the screen it lives on only appears after a dry run
 * has succeeded, which made the interesting part the hardest part to reach.
 */

export interface AccountOption {
  readonly number: string
  readonly name: string
  readonly type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  readonly isBlocked: boolean
}

export interface JournalOption {
  readonly code: string
  readonly name: string
  readonly type: 'memoriaal' | 'verkoop' | 'inkoop' | 'bank' | 'kas'
}

const BALANCE_SHEET: ReadonlySet<AccountOption['type']> = new Set(['asset', 'liability', 'equity'])

/**
 * The accounts an opening balance can legitimately touch.
 *
 * Not a convenience. A debtor position, a creditor position and the counter to
 * them are all balance-sheet positions by definition; booking one against a
 * cost or revenue account would restate the year's result by the whole
 * imported amount, and every screen would still look plausible afterwards.
 *
 * Blocked accounts are kept, for the screen to mark. The ledger refuses to
 * post to one, so hiding it turns a clear refusal into "my account is
 * missing".
 */
export function balanceSheetAccounts(accounts: readonly AccountOption[]): readonly AccountOption[] {
  return accounts.filter((account) => BALANCE_SHEET.has(account.type))
}

/**
 * The accounts a year's result can be appropriated to.
 *
 * `planYearClose` refuses anything that is not equity, and says so with the
 * account type in the message. Filtering here means the field offers what the
 * domain accepts rather than letting somebody pick a bank account and read
 * about it afterwards — the refusal is still there, it just has nothing left to
 * refuse.
 *
 * Blocked accounts are kept for the same reason as everywhere else: the picker
 * marks them and will not take them.
 */
export function equityAccounts(accounts: readonly AccountOption[]): readonly AccountOption[] {
  return accounts.filter((account) => account.type === 'equity')
}

/**
 * The dagboeken an opening entry belongs in.
 *
 * A memoriaal, and only that. An overname is not a sale or a purchase, and
 * offering the verkoopboek would let somebody file a migration as revenue.
 */
export function openingJournals(journals: readonly JournalOption[]): readonly JournalOption[] {
  return journals.filter((journal) => journal.type === 'memoriaal')
}

/**
 * The dagboek to use when there is nothing to choose.
 *
 * One memoriaal is the ordinary case, and presenting it as a decision is
 * asking somebody to confirm a fact. Empty when there are none or several,
 * because then it genuinely is a decision.
 */
export function defaultJournal(journals: readonly JournalOption[]): string {
  const [only] = openingJournals(journals)
  return openingJournals(journals).length === 1 ? (only?.code ?? '') : ''
}
