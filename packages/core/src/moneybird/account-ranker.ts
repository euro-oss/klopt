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
  /**
   * When true, drop out-of-scope 0% input codes (VGEEN). Used for Moneybird
   * purchase rates that are verlegd / EU acquisition / import — those must map
   * to VERL/ICV/INV, never to VGEEN.
   */
  readonly excludeOutOfScopeInput?: boolean
}

/**
 * Moneybird purchase rates that are reverse-charge received, EU acquisition or
 * import (article 23) — not plain domestic "geen btw".
 *
 * Detected from the rate name / report_reference: Moneybird books many of these
 * at 0% on the invoice even though Klopt's paired codes carry 9%/21%.
 *
 * A bare `eu` substring is not enough (would catch unrelated names). Prefer
 * specific terms (ICP/ICV, EU-levering, binnen EU, buiten EU / outside EU as
 * whole phrases, art. 23, …) — outside-EU 0% purchases are almost always
 * import / reverse-charged services and must not offer VGEEN (#86 / #90 PM).
 */
export function isSpecialAcquisitionPurchaseRate(rate: {
  readonly name: string
  readonly reportReference?: string | null
}): boolean {
  const text = `${rate.name} ${rate.reportReference ?? ''}`.toLowerCase()
  return (
    /verleg/.test(text) ||
    /reverse/.test(text) ||
    /intra\s*comm/.test(text) ||
    /intracommunautair/.test(text) ||
    /\bicp\b/.test(text) ||
    /\bicv\b/.test(text) ||
    /\beu-levering\b/.test(text) ||
    /\beu-verwerving\b/.test(text) ||
    /verwerving/.test(text) ||
    /invoer/.test(text) ||
    /\bimport\b/.test(text) ||
    /\bbinnen\s+eu\b/.test(text) ||
    /\bbuiten\s+eu\b/.test(text) ||
    /\bwithin\s+(?:the\s+)?eu\b/.test(text) ||
    /\boutside\s+(?:the\s+)?eu\b/.test(text) ||
    /\bart\.?\s*23\b/.test(text) ||
    /\barticle\s*23\b/.test(text) ||
    /\bartikel\s*23\b/.test(text)
  )
}

/** Minimal tax-rule shape for matching — same fields as `ExistingTaxRule`. */
export interface VatMatchRule {
  readonly code: string
  readonly rateBasisPoints: number
  readonly direction: 'input' | 'output'
  /**
   * Chart scope / reverse-charge / deduction pairing — optional so older
   * callers still match by direction + rate. When present, {@link rankVatCodes}
   * can put the plain domestic standard code first (#70).
   */
  readonly scope?: string
  readonly reverseCharge?: string
  readonly deductionCode?: string | null
  /** When set, only `full` (or omitted) may be primary — pro_rata / none are other. */
  readonly deductibility?: string
}

export type VatCandidateGroup = 'primary' | 'other'

export interface RankedVatCandidate {
  readonly rule: VatMatchRule
  readonly group: VatCandidateGroup
}

export interface RankedVatCodes {
  /** Plain domestic standard codes (H21, L9, VH21, VL9, …). */
  readonly primary: readonly VatMatchRule[]
  /** Verlegd, ICP, invoer, vrijgesteld, export, private use, deduction halves. */
  readonly other: readonly VatMatchRule[]
  /** primary then other — ready for a picker. */
  readonly candidates: readonly RankedVatCandidate[]
  /**
   * Pre-select when exactly one primary matches. Never set for ambiguous 0%
   * sales (VERL/GEEN/NUL/ICP/ICPD are all `other`).
   */
  readonly suggestedCode: string | null
}

/**
 * Existing VAT rules that match this Moneybird rate by direction and bps.
 *
 * When exactly one rule matches, the UI may offer a one-click "Gebruik {code}".
 * Unknown direction matches nothing — never guess "output" (#70 / #69).
 * Non-finite percentages (Infinity) match nothing; callers that treat a missing
 * Moneybird percentage as 0% must coerce before calling (#90).
 */
export function matchVatCodes(
  rules: readonly VatMatchRule[],
  query: VatMatchQuery,
): readonly VatMatchRule[] {
  // Unknown direction must not guess "output" — that would offer sales codes
  // for an unclassified Moneybird rate (#69 PM / #70).
  if (query.taxRateType !== 'purchase_invoice' && query.taxRateType !== 'sales_invoice') {
    return []
  }
  if (!Number.isFinite(query.percentage)) {
    return []
  }
  const bps = Math.round(query.percentage * 100)
  const direction = query.taxRateType === 'purchase_invoice' ? 'input' : 'output'
  return rules.filter((rule) => {
    if (rule.rateBasisPoints !== bps || rule.direction !== direction) return false
    if (
      query.excludeOutOfScopeInput === true &&
      direction === 'input' &&
      (rule.scope === 'out_of_scope' || rule.code === 'VGEEN')
    ) {
      return false
    }
    return true
  })
}

/**
 * True when this code is the plain domestic standard for its rate — not
 * verlegd, ICP, invoer, export, exempt, private use, a deduction half, or a
 * partial-deductibility (pro_rata) input code.
 *
 * Missing `scope` or `reverseCharge` never counts as primary: on a custom
 * chart that omitted metadata we must not pre-select (#70 PM).
 */
export function isPlainStandardVatCode(
  rule: VatMatchRule,
  chart: readonly VatMatchRule[],
): boolean {
  if (rule.scope === undefined || rule.reverseCharge === undefined) return false
  if (rule.scope !== 'domestic' || rule.reverseCharge !== 'none') return false
  // Omitted deductibility means full (chart codes that only set scope/RC).
  if (rule.deductibility !== undefined && rule.deductibility !== 'full') return false
  const deductionHalves = new Set(
    chart
      .map((entry) => entry.deductionCode)
      .filter((code): code is string => typeof code === 'string' && code !== ''),
  )
  return !deductionHalves.has(rule.code)
}

/**
 * Direction + rate matches, split into primary (standard) vs other, with a
 * suggested code only when exactly one primary exists (#70).
 */
export function rankVatCodes(rules: readonly VatMatchRule[], query: VatMatchQuery): RankedVatCodes {
  const matches = matchVatCodes(rules, query)
  const primary = matches.filter((rule) => isPlainStandardVatCode(rule, rules))
  const other = matches.filter((rule) => !isPlainStandardVatCode(rule, rules))
  const candidates: RankedVatCandidate[] = [
    ...primary.map((rule) => ({ rule, group: 'primary' as const })),
    ...other.map((rule) => ({ rule, group: 'other' as const })),
  ]
  return {
    primary,
    other,
    candidates,
    suggestedCode: primary.length === 1 ? (primary[0]?.code ?? null) : null,
  }
}

/** True when the UI may offer the VAT one-click shortcut (exactly one primary). */
export function hasUniqueVatMatch(rules: readonly VatMatchRule[], query: VatMatchQuery): boolean {
  return rankVatCodes(rules, query).suggestedCode !== null
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
