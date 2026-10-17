/**
 * Suggesting a Klopt account (or VAT code) for a Moneybird finding.
 *
 * Ranking is RGS code first, then number, then name — Design's "#42 Stap —
 * Categorie + btw-tarief" board and the Phase 1 CoS scope. The generic
 * account picker ranks by typed fragment; this ranker ranks by how well a
 * Moneybird ledger row matches an existing Klopt account before the user
 * types anything.
 *
 * Deliberately does not import from `plan.ts` — plan imports `nextFreeNumber`
 * from here, and a cycle would fail the boundary check.
 */

export interface RankableAccount {
  readonly number: string
  readonly name: string
  readonly rgsCode: string | null
}

export interface AccountSuggestionQuery {
  /** Moneybird / planned RGS lead code, when present. */
  readonly rgsCode: string | null
  /** Moneybird ledger number (may be empty when unmapped). */
  readonly number: string
  readonly name: string
  /** Optional free-text filter the user typed. */
  readonly query?: string
}

export interface RankedAccount {
  readonly account: RankableAccount
  /** Lower is better. 0 is an exact RGS match. */
  readonly rank: number
  readonly reason: 'rgs' | 'number' | 'number_prefix' | 'name' | 'name_contains'
}

/**
 * Accounts that could map to this Moneybird row, best first.
 *
 * Order within a reason group keeps the caller's original order so the result
 * is stable and hashable for tests.
 */
export function rankAccountSuggestions(
  accounts: readonly RankableAccount[],
  query: AccountSuggestionQuery,
): readonly RankedAccount[] {
  const typed = (query.query ?? '').trim().toLowerCase()
  const wantRgs = query.rgsCode?.trim().toUpperCase() ?? ''
  const wantNumber = query.number.trim()
  const wantName = query.name.trim().toLowerCase()
  const scored: RankedAccount[] = []

  accounts.forEach((account, position) => {
    if (typed !== '') {
      const number = account.number.toLowerCase()
      const name = account.name.toLowerCase()
      const terms = typed.split(/\s+/).filter(Boolean)
      if (!terms.every((term) => number.includes(term) || name.includes(term))) return
    }

    const rgs = account.rgsCode?.trim().toUpperCase() ?? ''
    let reason: RankedAccount['reason']
    let rank: number

    if (
      wantRgs !== '' &&
      rgs !== '' &&
      (rgs === wantRgs || rgs.startsWith(wantRgs) || wantRgs.startsWith(rgs))
    ) {
      reason = 'rgs'
      rank = rgs === wantRgs ? 0 : 1
    } else if (wantNumber !== '' && account.number === wantNumber) {
      reason = 'number'
      rank = 2
    } else if (wantNumber !== '' && account.number.startsWith(wantNumber)) {
      reason = 'number_prefix'
      rank = 3
    } else if (wantName !== '' && account.name.toLowerCase() === wantName) {
      reason = 'name'
      rank = 4
    } else if (
      wantName !== '' &&
      account.name
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .some((word) => word.startsWith(wantName.split(/\s+/)[0] ?? wantName))
    ) {
      reason = 'name'
      rank = 5
    } else if (wantName !== '' && account.name.toLowerCase().includes(wantName)) {
      reason = 'name_contains'
      rank = 6
    } else if (typed !== '') {
      // Typed filter matched; no Moneybird hint beat it.
      reason = 'name_contains'
      rank = 7
    } else {
      return
    }

    scored.push({ account, rank, reason })
    void position
  })

  return scored.sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank
    return left.account.number.localeCompare(right.account.number)
  })
}

export interface VatMatchQuery {
  /** Moneybird percentage as a number (21, 9, 0, …). */
  readonly percentage: number
  /** Moneybird `tax_rate_type`: sales_invoice → output, purchase_invoice → input. */
  readonly taxRateType: string
}

/** Minimal tax-rule shape for matching — same fields as `ExistingTaxRule`. */
export interface VatMatchRule {
  readonly code: string
  readonly rateBasisPoints: number
  readonly direction: 'input' | 'output'
}

/**
 * Existing VAT rules that match this Moneybird rate by direction and bps.
 *
 * When exactly one rule matches, the UI may offer a one-click "Gebruik {code}".
 */
export function matchVatCodes(
  rules: readonly VatMatchRule[],
  query: VatMatchQuery,
): readonly VatMatchRule[] {
  const bps = Math.round(query.percentage * 100)
  const direction = query.taxRateType === 'purchase_invoice' ? 'input' : 'output'
  return rules.filter((rule) => rule.rateBasisPoints === bps && rule.direction === direction)
}

/** True when the UI may offer the VAT one-click shortcut. */
export function hasUniqueVatMatch(rules: readonly VatMatchRule[], query: VatMatchQuery): boolean {
  return matchVatCodes(rules, query).length === 1
}

/**
 * Next free account / contact number after `preferred`, given what is already
 * taken. Tries preferred, then preferred+1, … as decimal integers when the
 * preferred value looks numeric; otherwise appends `-2`, `-3`, …
 */
export function nextFreeNumber(
  preferred: string,
  taken: ReadonlySet<string> | readonly string[],
): string {
  const occupied = taken instanceof Set ? taken : new Set(taken)
  if (!occupied.has(preferred) && preferred.trim() !== '') return preferred

  if (/^\d+$/.test(preferred)) {
    let candidate = BigInt(preferred) + 1n
    for (;;) {
      const text = candidate.toString()
      if (!occupied.has(text)) return text
      candidate += 1n
    }
  }

  const base = preferred.trim() === '' ? 'MB' : preferred
  let suffix = 2
  for (;;) {
    const text = `${base}-${String(suffix)}`
    if (!occupied.has(text)) return text
    suffix += 1
  }
}
