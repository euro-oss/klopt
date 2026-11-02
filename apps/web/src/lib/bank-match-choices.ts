/**
 * ChoiceOption 1–4 for the Match board (#107 Phase 7 / Match.dc.html).
 *
 * Fixed taxonomy from the export; at most one option is `suggested`, driven by
 * the existing suggestMatches payload (invoice allocations vs learned account).
 * Option 4 always opens the full booking form. Split (#76) and the Uitgave
 * sheet (#77) stay separate — cost / transfer open the form as an interim.
 */

export type MatchChoiceId = 'cost' | 'invoice' | 'transfer' | 'other'

export type MatchChoiceKey = '1' | '2' | '3' | '4'

export interface MatchSuggestionLike {
  readonly strategy: string
  readonly confidence: number
  readonly reason: string
  readonly accountNumber: string | null
  readonly chargesAmount: string
  readonly chargesAccountNumber: string | null
  readonly ruleId: string | null
  readonly allocations: readonly { invoiceId: string; number: string; amount: string }[]
}

export type MatchChoiceAction =
  | { readonly type: 'book_suggestion'; readonly suggestion: MatchSuggestionLike }
  | { readonly type: 'open_form' }

export interface MatchChoice {
  readonly id: MatchChoiceId
  readonly key: MatchChoiceKey
  readonly suggested: boolean
  readonly action: MatchChoiceAction
  /** Invoice numbers when the invoice path has a concrete suggestion. */
  readonly invoiceNumbers: readonly string[]
  /** Learned / rule account when the cost path can book immediately. */
  readonly accountNumber: string | null
}

/**
 * Build the four Match choices for one line.
 *
 * - Top suggestion with allocations → invoice is suggested (and books that).
 * - Top suggestion with only an account → cost is suggested (and books that).
 * - Otherwise nothing is suggested; cost / transfer / other open the form.
 */
export function buildMatchChoices(
  suggestions: readonly MatchSuggestionLike[] | null,
): readonly MatchChoice[] {
  const top = suggestions !== null && suggestions.length > 0 ? suggestions[0]! : null
  const invoiceSuggestion =
    top !== null && top.allocations.length > 0
      ? top
      : (suggestions?.find((item) => item.allocations.length > 0) ?? null)
  const accountSuggestion =
    top !== null && top.allocations.length === 0 && top.accountNumber !== null
      ? top
      : (suggestions?.find(
          (item) => item.allocations.length === 0 && item.accountNumber !== null,
        ) ?? null)

  const suggestInvoice = invoiceSuggestion !== null && top === invoiceSuggestion
  const suggestCost = !suggestInvoice && accountSuggestion !== null && top === accountSuggestion

  return [
    {
      id: 'cost',
      key: '1',
      suggested: suggestCost,
      action:
        accountSuggestion !== null
          ? { type: 'book_suggestion', suggestion: accountSuggestion }
          : { type: 'open_form' },
      invoiceNumbers: [],
      accountNumber: accountSuggestion?.accountNumber ?? null,
    },
    {
      id: 'invoice',
      key: '2',
      suggested: suggestInvoice,
      action:
        invoiceSuggestion !== null
          ? { type: 'book_suggestion', suggestion: invoiceSuggestion }
          : { type: 'open_form' },
      invoiceNumbers: invoiceSuggestion?.allocations.map((row) => row.number) ?? [],
      accountNumber: null,
    },
    {
      id: 'transfer',
      key: '3',
      suggested: false,
      action: { type: 'open_form' },
      invoiceNumbers: [],
      accountNumber: null,
    },
    {
      id: 'other',
      key: '4',
      suggested: false,
      action: { type: 'open_form' },
      invoiceNumbers: [],
      accountNumber: null,
    },
  ]
}

/** Progress bar width for `done` of `total` (0–100). */
export function matchProgressPercent(done: number, total: number): number {
  if (total <= 0) return 100
  if (done <= 0) return 0
  return Math.min(100, Math.round((done / total) * 100))
}
