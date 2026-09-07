import { violation, LedgerError } from '../errors.js'
import type { BankEntry } from './model.js'

/**
 * Matching a bank line to what it paid for (spec 7.4).
 *
 * "Rule layer first: exact match on invoice number or payment reference, then
 * IBAN plus amount, then fuzzy on name and amount within a tolerance.
 * Everything else goes to a suggestion queue with a confidence score and a
 * one-keystroke confirm."
 *
 * Three properties this module is built around, and each is a decision:
 *
 * **It suggests; it never decides.** Every function here returns candidates
 * with a confidence and a reason in words. Nothing is posted until a human
 * confirms, because a wrong automatic match is worse than no match: it clears
 * an invoice that is still owed, and the error surfaces months later as a
 * debtor balance nobody can explain.
 *
 * **The reason is part of the output.** "Learned rules are visible and
 * editable, never a black box" — and the same standard applies to a match. A
 * suggestion that cannot say *why* is a suggestion a bookkeeper has to check
 * from scratch, which is no saving at all.
 *
 * **Amounts are exact until they are deliberately not.** Every comparison is
 * integer, and the two places a tolerance is allowed — bank charges deducted
 * from a payment, and fuzzy name scoring — are both explicit and both bounded.
 */

export type MatchStrategy =
  'reference' | 'iban_amount' | 'learned_rule' | 'fuzzy_name' | 'oldest_first'

/** An invoice a payment could be for. Outstanding, not total: see `outstanding`. */
export interface MatchCandidate {
  readonly invoiceId: string
  readonly number: string
  readonly kind: 'invoice' | 'credit_note'
  readonly contactId: string
  readonly contactName: string
  readonly contactIban: string | null
  readonly issueDate: string
  readonly dueDate: string
  /** What is still owed: the total less anything already allocated. */
  readonly outstanding: bigint
  readonly currency: string
}

/**
 * A rule, learned or written by hand.
 *
 * "Learn from confirmations: store counterparty, description pattern, and the
 * account or contact the human chose, and use it as a rule next time."
 *
 * A rule points at a ledger account, a contact, or both. It never points at an
 * invoice — an invoice is paid once, and a rule that fired twice on the same
 * one would be a bug rather than a convenience.
 */
export interface MatchRule {
  readonly id: string
  readonly source: 'learned' | 'manual'
  /** Matched exactly, ignoring spaces and case. The strongest signal there is. */
  readonly counterpartyIban: string | null
  /** Matched as a case-insensitive substring of the counterparty name. */
  readonly counterpartyName: string | null
  /** Matched as a case-insensitive substring of the description. */
  readonly descriptionContains: string | null
  readonly accountNumber: string | null
  readonly contactId: string | null
  /** How many confirmations are behind it. Feeds the confidence. */
  readonly timesApplied: number
  readonly isActive: boolean
}

export interface Allocation {
  readonly invoiceId: string
  readonly number: string
  /** Signed the same way as the transaction: what this invoice absorbs. */
  readonly amount: bigint
}

export interface MatchSuggestion {
  readonly strategy: MatchStrategy
  /** 0 to 100. Sorted descending; a queue is only as useful as its order. */
  readonly confidence: number
  /** Why, in words a bookkeeper can check without opening anything. */
  readonly reason: string
  readonly allocations: readonly Allocation[]
  /** Where the remainder goes, when the allocations do not cover the line. */
  readonly accountNumber: string | null
  readonly contactId: string | null
  /**
   * Bank charges deducted from the payment: the invoice is settled in full and
   * the difference is a cost. Zero unless a charge was detected.
   */
  readonly chargesAmount: bigint
  readonly ruleId: string | null
}

export interface MatchOptions {
  /**
   * The largest difference that may be treated as bank charges rather than a
   * partial payment.
   *
   * Both a ceiling and a proportion, because either alone is wrong: 15 euro off
   * a 20 euro invoice is not a bank charge, and 0.5% of 40,000 euro is not
   * either. A foreign transfer costs a few euro, which is what this is for.
   */
  readonly maximumCharges: bigint
  readonly maximumChargesFraction: number
  /** Where detected charges are posted. Null disables charge detection. */
  readonly chargesAccountNumber: string | null
  /** 0 to 1. Below this, a name is not considered a match at all. */
  readonly nameThreshold: number
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  maximumCharges: 1_500n,
  maximumChargesFraction: 0.02,
  chargesAccountNumber: null,
  nameThreshold: 0.6,
}

/** Legal forms carry no information for matching and wreck a similarity score. */
const LEGAL_FORMS =
  /\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|c\.?v\.?|holding|beheer|gmbh|ltd|limited|inc|s\.?a\.?|sarl|bvba|nv|bv)\b/g

export function normaliseName(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      // Strip diacritics: "Sébastien" and "Sebastien" are the same customer.
      .replace(/[̀-ͯ]/g, '')
      .replace(LEGAL_FORMS, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  )
}

export function normaliseIbanForMatch(value: string): string {
  return value.replace(/\s/g, '').toUpperCase()
}

/**
 * How alike two names are, 0 to 1.
 *
 * Dice coefficient over character bigrams. Chosen over edit distance because it
 * is insensitive to word order — "Jansen Transport" and "Transport Jansen" are
 * the same firm, and Levenshtein rates them as barely related.
 */
export function nameSimilarity(left: string, right: string): number {
  const a = normaliseName(left).replace(/\s/g, '')
  const b = normaliseName(right).replace(/\s/g, '')

  if (a === '' || b === '') return 0
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0

  const bigrams = new Map<string, number>()
  for (let index = 0; index < a.length - 1; index += 1) {
    const pair = a.slice(index, index + 2)
    bigrams.set(pair, (bigrams.get(pair) ?? 0) + 1)
  }

  let shared = 0
  for (let index = 0; index < b.length - 1; index += 1) {
    const pair = b.slice(index, index + 2)
    const available = bigrams.get(pair) ?? 0
    if (available > 0) {
      bigrams.set(pair, available - 1)
      shared += 1
    }
  }

  return (2 * shared) / (a.length - 1 + (b.length - 1))
}

/** Every place a payer might have put a reference, as one searchable string. */
function referenceHaystack(entry: BankEntry): string {
  return [entry.endToEndId, entry.remittanceReference, entry.description]
    .filter((part): part is string => part !== null && part !== '')
    .join(' ')
}

/**
 * Does this text contain the invoice number?
 *
 * Two passes, because the two ways people write a reference need opposite
 * treatment:
 *
 *  1. **As written**, bounded by non-alphanumerics. This is what finds
 *     `2026-0002` in `facturen 2026-0002 2026-0003` — three invoice numbers in
 *     a row, which a batch payment description is full of.
 *  2. **With separators removed**, bounded by digits. This is what finds
 *     `2026-0001` in `fact 20260001`, because a payer typing an invoice number
 *     into a banking app drops the hyphen about half the time.
 *
 * A single squashed pass cannot do both: squashing `2026-0002 2026-0003` runs
 * the numbers together and the boundary check then rejects them all. Doing only
 * the first misses every payer who dropped the hyphen.
 *
 * The boundary is the load-bearing part either way: `2026-0001` must not match
 * inside `2026-00012`, which is a different invoice.
 */
export function mentionsNumber(haystack: string, number: string): boolean {
  const trimmed = number.trim()
  if (trimmed.replace(/[^a-z0-9]/gi, '').length < 4) return false

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`(^|[^0-9A-Za-z])${escaped}([^0-9A-Za-z]|$)`, 'i').test(haystack)) return true

  const squashedHaystack = haystack.toLowerCase().replace(/[^a-z0-9]/g, '')
  const squashedNumber = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '')

  let at = squashedHaystack.indexOf(squashedNumber)
  while (at !== -1) {
    const before = squashedHaystack[at - 1]
    const after = squashedHaystack[at + squashedNumber.length]
    // A digit on either side means this is part of a longer number.
    const boundedBefore = before === undefined || !/\d/.test(before)
    const boundedAfter = after === undefined || !/\d/.test(after)
    if (boundedBefore && boundedAfter) return true
    at = squashedHaystack.indexOf(squashedNumber, at + 1)
  }

  return false
}

function ruleMatches(rule: MatchRule, entry: BankEntry): boolean {
  if (!rule.isActive) return false

  // A rule with no conditions would match everything, which is not a rule.
  let conditions = 0

  if (rule.counterpartyIban !== null) {
    conditions += 1
    if (
      entry.counterpartyIban === null ||
      normaliseIbanForMatch(entry.counterpartyIban) !== normaliseIbanForMatch(rule.counterpartyIban)
    ) {
      return false
    }
  }

  if (rule.counterpartyName !== null) {
    conditions += 1
    const name = normaliseName(entry.counterpartyName ?? '')
    if (name === '' || !name.includes(normaliseName(rule.counterpartyName))) return false
  }

  if (rule.descriptionContains !== null) {
    conditions += 1
    if (!entry.description.toLowerCase().includes(rule.descriptionContains.toLowerCase())) {
      return false
    }
  }

  return conditions > 0
}

/**
 * A rule's confidence.
 *
 * An IBAN condition is worth more than a name, and a rule confirmed twenty
 * times is worth more than one confirmed once — but it tops out well below
 * certainty, because a rule is a habit and habits have exceptions.
 */
function ruleConfidence(rule: MatchRule): number {
  const base = rule.counterpartyIban !== null ? 80 : 65
  const learned = Math.min(12, rule.timesApplied * 2)
  return Math.min(94, base + learned)
}

function chargesFor(difference: bigint, outstanding: bigint, options: MatchOptions): bigint | null {
  if (difference <= 0n || options.chargesAccountNumber === null) return null
  if (difference > options.maximumCharges) return null

  const magnitude = outstanding < 0n ? -outstanding : outstanding
  if (magnitude === 0n) return null

  // Integer comparison of difference/outstanding against the fraction, without
  // a float: difference * 10000 <= outstanding * fraction * 10000.
  const permitted =
    (magnitude * BigInt(Math.round(options.maximumChargesFraction * 10_000))) / 10_000n
  return difference <= permitted ? difference : null
}

/**
 * What this bank line might be.
 *
 * Returned sorted by confidence, highest first, and never empty-handed: when
 * nothing matches, the caller gets an empty list and shows the line for manual
 * treatment, which is the honest outcome.
 */
export function suggestMatches(
  entry: BankEntry,
  candidates: readonly MatchCandidate[],
  rules: readonly MatchRule[],
  options: MatchOptions = DEFAULT_MATCH_OPTIONS,
): readonly MatchSuggestion[] {
  if (entry.amount === 0n) {
    throw new LedgerError([
      violation('line_no_amount', 'amount', 'A bank line with no amount cannot be matched.'),
    ])
  }

  const suggestions: MatchSuggestion[] = []
  const haystack = referenceHaystack(entry)
  const incoming = entry.amount > 0n

  // A receipt settles a sales invoice; a payment out settles a credit note.
  // Anything in the wrong direction is not a candidate for this line.
  const relevant = candidates.filter(
    (candidate) =>
      candidate.currency === entry.currency &&
      candidate.outstanding !== 0n &&
      (incoming ? candidate.kind === 'invoice' : candidate.kind === 'credit_note'),
  )

  const magnitude = incoming ? entry.amount : -entry.amount

  // 1. The reference. A payer who quoted the invoice number has told us the
  //    answer, and no amount of cleverness beats being told.
  const named = relevant.filter((candidate) => mentionsNumber(haystack, candidate.number))

  if (named.length === 1) {
    const candidate = named[0]!
    const difference = candidate.outstanding - magnitude
    const charges = chargesFor(difference, candidate.outstanding, options)

    if (difference === 0n) {
      suggestions.push({
        strategy: 'reference',
        confidence: 99,
        reason: `Factuurnummer ${candidate.number} staat in de omschrijving en het bedrag klopt precies.`,
        allocations: [
          { invoiceId: candidate.invoiceId, number: candidate.number, amount: entry.amount },
        ],
        accountNumber: null,
        contactId: candidate.contactId,
        chargesAmount: 0n,
        ruleId: null,
      })
    } else if (charges !== null) {
      suggestions.push({
        strategy: 'reference',
        confidence: 92,
        reason:
          `Factuurnummer ${candidate.number} staat in de omschrijving. Er is ` +
          `${charges.toString()} minder ontvangen, wat als bankkosten wordt geboekt.`,
        allocations: [
          {
            invoiceId: candidate.invoiceId,
            number: candidate.number,
            amount: candidate.outstanding * (incoming ? 1n : -1n),
          },
        ],
        accountNumber: options.chargesAccountNumber,
        contactId: candidate.contactId,
        chargesAmount: charges,
        ruleId: null,
      })
    } else {
      suggestions.push({
        strategy: 'reference',
        confidence: 88,
        reason:
          `Factuurnummer ${candidate.number} staat in de omschrijving, maar het bedrag wijkt af: ` +
          `openstaand ${candidate.outstanding.toString()}, ontvangen ${magnitude.toString()}. ` +
          (difference > 0n ? 'Deelbetaling.' : 'Er is meer ontvangen dan openstaat.'),
        allocations: [
          {
            invoiceId: candidate.invoiceId,
            number: candidate.number,
            // A partial payment allocates what arrived; an overpayment
            // allocates only what was owed and leaves the rest to the caller.
            amount: (difference > 0n ? magnitude : candidate.outstanding) * (incoming ? 1n : -1n),
          },
        ],
        accountNumber: null,
        contactId: candidate.contactId,
        chargesAmount: 0n,
        ruleId: null,
      })
    }
  } else if (named.length > 1) {
    // Several invoice numbers in one description is a batch payment, and the
    // payer has told us exactly which ones.
    const total = named.reduce((sum, candidate) => sum + candidate.outstanding, 0n)
    suggestions.push({
      strategy: 'reference',
      confidence: total === magnitude ? 97 : 84,
      reason:
        `${String(named.length)} factuurnummers staan in de omschrijving ` +
        `(${named.map((candidate) => candidate.number).join(', ')})` +
        (total === magnitude
          ? ' en samen komen ze precies uit.'
          : ', maar samen komen ze niet uit.'),
      allocations: named.map((candidate) => ({
        invoiceId: candidate.invoiceId,
        number: candidate.number,
        amount: candidate.outstanding * (incoming ? 1n : -1n),
      })),
      accountNumber: null,
      contactId: named[0]!.contactId,
      chargesAmount: 0n,
      ruleId: null,
    })
  }

  // 2. IBAN plus amount. No reference, but the money came from an account we
  //    know and the amount is exactly what one of their invoices says.
  if (entry.counterpartyIban !== null) {
    const iban = normaliseIbanForMatch(entry.counterpartyIban)
    const byIban = relevant.filter(
      (candidate) =>
        candidate.contactIban !== null && normaliseIbanForMatch(candidate.contactIban) === iban,
    )
    const exact = byIban.filter((candidate) => candidate.outstanding === magnitude)

    if (exact.length === 1) {
      const candidate = exact[0]!
      suggestions.push({
        strategy: 'iban_amount',
        confidence: 90,
        reason: `Van het rekeningnummer van ${candidate.contactName}, en het bedrag is precies factuur ${candidate.number}.`,
        allocations: [
          { invoiceId: candidate.invoiceId, number: candidate.number, amount: entry.amount },
        ],
        accountNumber: null,
        contactId: candidate.contactId,
        chargesAmount: 0n,
        ruleId: null,
      })
    } else if (exact.length > 1) {
      // Two invoices for the same amount from the same customer. A human has
      // to choose, and saying so is more useful than picking one.
      suggestions.push({
        strategy: 'iban_amount',
        confidence: 55,
        reason:
          `Van het rekeningnummer van ${exact[0]!.contactName}, maar ${String(exact.length)} ` +
          'facturen hebben precies dit bedrag. Kies welke.',
        allocations: [],
        accountNumber: null,
        contactId: exact[0]!.contactId,
        chargesAmount: 0n,
        ruleId: null,
      })
    } else if (byIban.length > 0) {
      // Known customer, amount matches nothing. Oldest first is what a
      // bookkeeper does, so propose it and say that is what it is.
      const allocations = allocateOldestFirst(byIban, magnitude, incoming)
      if (allocations.length > 0) {
        const allocated = allocations.reduce(
          (sum, item) => sum + (item.amount < 0n ? -item.amount : item.amount),
          0n,
        )
        suggestions.push({
          strategy: 'oldest_first',
          confidence: allocated === magnitude ? 70 : 60,
          reason:
            `Van het rekeningnummer van ${byIban[0]!.contactName}. Geen factuurnummer in de ` +
            `omschrijving, dus toegerekend aan de oudste ${String(allocations.length)} ` +
            (allocations.length === 1 ? 'factuur.' : 'facturen.'),
          allocations,
          accountNumber: null,
          contactId: byIban[0]!.contactId,
          chargesAmount: 0n,
          ruleId: null,
        })
      }
    }
  }

  // 3. Learned rules. What a human chose last time for a line that looked
  //    like this. Never an invoice — see the note on MatchRule.
  for (const rule of rules) {
    if (!ruleMatches(rule, entry)) continue

    const conditions = [
      rule.counterpartyIban !== null ? 'het rekeningnummer' : null,
      rule.counterpartyName !== null ? `de naam "${rule.counterpartyName}"` : null,
      rule.descriptionContains !== null ? `"${rule.descriptionContains}" in de omschrijving` : null,
    ].filter((part): part is string => part !== null)

    suggestions.push({
      strategy: 'learned_rule',
      confidence: ruleConfidence(rule),
      reason:
        `${rule.source === 'learned' ? 'Eerder zo geboekt' : 'Vaste regel'}: ${conditions.join(' en ')}` +
        (rule.timesApplied > 0 ? ` (${String(rule.timesApplied)}x toegepast).` : '.'),
      allocations: [],
      accountNumber: rule.accountNumber,
      contactId: rule.contactId,
      chargesAmount: 0n,
      ruleId: rule.id,
    })
  }

  /**
   * 4. Fuzzy on the name, with the amount as corroboration.
   *
   * The weakest layer, and the last resort: it only runs when no stronger layer
   * proposed an invoice at all. Otherwise it undermines them — when the IBAN
   * layer has said "two invoices have this amount, choose one", a confident
   * guess based on the name being similar is worse than the honest ambiguity it
   * would outrank.
   */
  const strongerFired = suggestions.some(
    (item) =>
      item.strategy === 'reference' ||
      item.strategy === 'iban_amount' ||
      item.strategy === 'oldest_first',
  )

  if (!strongerFired && entry.counterpartyName !== null && entry.counterpartyName !== '') {
    const scored = relevant
      .map((candidate) => ({
        candidate,
        score: nameSimilarity(entry.counterpartyName ?? '', candidate.contactName),
      }))
      .filter((item) => item.score >= options.nameThreshold)
      .sort((a, b) => b.score - a.score)

    const best = scored.find((item) => item.candidate.outstanding === magnitude)
    if (best !== undefined) {
      suggestions.push({
        strategy: 'fuzzy_name',
        confidence: Math.round(55 + best.score * 20),
        reason:
          `De naam "${entry.counterpartyName}" lijkt op ${best.candidate.contactName} ` +
          `(${String(Math.round(best.score * 100))}% overeenkomst) en het bedrag is precies ` +
          `factuur ${best.candidate.number}.`,
        allocations: [
          {
            invoiceId: best.candidate.invoiceId,
            number: best.candidate.number,
            amount: entry.amount,
          },
        ],
        accountNumber: null,
        contactId: best.candidate.contactId,
        chargesAmount: 0n,
        ruleId: null,
      })
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence)
}

/**
 * Spread an amount over invoices, oldest first.
 *
 * What a bookkeeper does with an unreferenced payment, and it stops at what
 * arrived rather than allocating a penny more.
 */
export function allocateOldestFirst(
  candidates: readonly MatchCandidate[],
  magnitude: bigint,
  incoming: boolean,
): readonly Allocation[] {
  const ordered = [...candidates].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const allocations: Allocation[] = []
  let remaining = magnitude

  for (const candidate of ordered) {
    if (remaining <= 0n) break
    const take = candidate.outstanding < remaining ? candidate.outstanding : remaining
    if (take <= 0n) continue
    allocations.push({
      invoiceId: candidate.invoiceId,
      number: candidate.number,
      amount: take * (incoming ? 1n : -1n),
    })
    remaining -= take
  }

  return allocations
}

/**
 * The rule a confirmation teaches.
 *
 * Only from a line that had no invoice reference: a payment quoting its invoice
 * number teaches nothing, because the next one will quote its own. What is
 * worth learning is "money from this account, described like this, goes to this
 * account" — a subscription, a bank charge, a utility bill.
 *
 * The IBAN is preferred to the name because it is exact. The description is
 * only added when there is no IBAN, and then only its most distinctive word,
 * because a rule on a whole description matches nothing twice.
 */
export function ruleToLearn(
  entry: BankEntry,
  chosen: { accountNumber: string | null; contactId: string | null },
): Pick<
  MatchRule,
  'counterpartyIban' | 'counterpartyName' | 'descriptionContains' | 'accountNumber' | 'contactId'
> | null {
  if (chosen.accountNumber === null && chosen.contactId === null) return null

  if (entry.counterpartyIban !== null && entry.counterpartyIban !== '') {
    return {
      counterpartyIban: normaliseIbanForMatch(entry.counterpartyIban),
      counterpartyName: null,
      descriptionContains: null,
      accountNumber: chosen.accountNumber,
      contactId: chosen.contactId,
    }
  }

  const name = (entry.counterpartyName ?? '').trim()
  if (name !== '') {
    return {
      counterpartyIban: null,
      counterpartyName: name,
      descriptionContains: null,
      accountNumber: chosen.accountNumber,
      contactId: chosen.contactId,
    }
  }

  // No counterparty at all: the description is all there is. Take the longest
  // word, which is the one most likely to be a name rather than a preposition.
  const distinctive = entry.description
    .split(/\s+/)
    .filter((word) => word.length >= 5)
    .sort((a, b) => b.length - a.length)[0]

  if (distinctive === undefined) return null

  return {
    counterpartyIban: null,
    counterpartyName: null,
    descriptionContains: distinctive,
    accountNumber: chosen.accountNumber,
    contactId: chosen.contactId,
  }
}
