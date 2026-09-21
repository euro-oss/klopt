/**
 * Which grootboekrekening a typed fragment means.
 *
 * `1300`, `deb` and `debiteuren` all find Debiteuren — that is the picker
 * contract in docs/keyboard-map.md, and it is two habits rather than one
 * preference: bookkeepers who have used the same chart for fifteen years type
 * numbers, and everybody else types words. A picker that matches only the
 * number serves the first group and leaves the second reading a list.
 *
 * The rule lives here rather than in the component so it can be tested by
 * naming a fragment instead of by driving a browser, which is the same split
 * every other keyboard decision in this application is written under.
 */

export interface PickableAccount {
  readonly number: string
  readonly name: string
  /**
   * Blocked accounts are offered and refused, never quietly dropped: the
   * ledger will not post to one, and hiding it turns a clear refusal into "my
   * account is missing" (see `~/lib/account-options`).
   */
  readonly isBlocked?: boolean
}

/** True when the ledger would accept a posting to this account. */
export function isPostable(account: PickableAccount): boolean {
  return !(account.isBlocked ?? false)
}

/**
 * The accounts a fragment could mean, best first.
 *
 * Every whitespace-separated term has to appear somewhere in the number or the
 * name, so `kosten 44` and `44 kosten` both find 4400 Kantoorkosten. Order is
 * the part worth being deliberate about, because the first match is the one
 * `Enter` takes: a number that starts the account number comes before a word
 * that starts its name, which comes before a fragment found in the middle.
 * Blocked accounts sink to the bottom of their group — still visible, never
 * the default.
 */
export function filterAccounts(
  accounts: readonly PickableAccount[],
  query: string,
): readonly PickableAccount[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return accounts

  const scored: { account: PickableAccount; rank: number; position: number }[] = []

  accounts.forEach((account, position) => {
    const number = account.number.toLowerCase()
    const name = account.name.toLowerCase()

    const everyTermFound = terms.every((term) => number.includes(term) || name.includes(term))
    if (!everyTermFound) return

    const first = terms[0] ?? ''
    const rank =
      (number === first ? 0 : number.startsWith(first) ? 1 : startsAWord(name, first) ? 2 : 3) +
      (isPostable(account) ? 0 : 4)

    scored.push({ account, rank, position })
  })

  return scored
    .sort((left, right) => left.rank - right.rank || left.position - right.position)
    .map((entry) => entry.account)
}

/** `deb` starts a word in "Debiteuren", and also in "Vooruitbetaalde debet". */
function startsAWord(text: string, term: string): boolean {
  return text.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(term))
}

/**
 * The account a field's text stands for, or nothing.
 *
 * An exact number is taken as written — that is what somebody typing `4400`
 * means, even when another account happens to contain those digits. Failing
 * that, a fragment with exactly one postable match resolves to it, so `deb`
 * leaving the field is the account rather than four characters the server will
 * reject. Anything ambiguous resolves to nothing, and the field says so rather
 * than guessing.
 */
export function resolveAccount(
  accounts: readonly PickableAccount[],
  text: string,
): PickableAccount | null {
  const wanted = text.trim()
  if (wanted === '') return null

  const exact = accounts.find((account) => account.number === wanted)
  if (exact !== undefined) return isPostable(exact) ? exact : null

  const matches = filterAccounts(accounts, wanted).filter(isPostable)
  return matches.length === 1 ? (matches[0] ?? null) : null
}
