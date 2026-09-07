/**
 * A bank statement, whatever it arrived as (spec 7.4).
 *
 * "API and file import must produce an identical transaction stream so nothing
 * downstream cares which one is in use." This is that stream. CAMT.053, MT940,
 * a CSV mapping and — later — an aggregator's JSON all land here, and the
 * matching engine has never heard of any of them.
 *
 * **Amounts are signed minor units, positive meaning money in.** MT940 and
 * CAMT both carry magnitude plus a debit/credit marker, and both invert the
 * meaning of that marker depending on whose statement it is. Resolving it once,
 * at the edge, is the difference between one confusing bug and twenty.
 */

export type BankStatementFormat = 'camt.053' | 'mt940' | 'csv'

export interface BankEntry {
  /** Signed minor units. Positive is a receipt, negative a payment. */
  readonly amount: bigint
  readonly currency: string
  /** When the bank booked it. */
  readonly bookingDate: string
  /** When it counts for interest. Often the same day, sometimes not. */
  readonly valueDate: string
  /**
   * The bank's own reference for this entry.
   *
   * The dedupe key when there is one: a bank that supplies it guarantees it is
   * unique within the account, which no hash of the content can. Absent in
   * plenty of real MT940, hence the fallback.
   */
  readonly bankReference: string | null
  /** SEPA end-to-end id, which a payer's system often fills with the invoice number. */
  readonly endToEndId: string | null
  readonly counterpartyName: string | null
  readonly counterpartyIban: string | null
  /** Free-text remittance information, joined. What a human reads. */
  readonly description: string
  /** A structured creditor reference, when the payer used one. */
  readonly remittanceReference: string | null
  /** The bank's transaction code, kept as-is. Useful for learned rules. */
  readonly transactionCode: string | null
  /** Exactly what the file said, for the content hash and for an audit. */
  readonly raw: string
}

export interface BankStatement {
  readonly format: BankStatementFormat
  /** The account this is a statement of. */
  readonly accountIban: string
  readonly currency: string
  /** The bank's identifier for this statement. */
  readonly statementId: string | null
  /**
   * The sequence number within the account.
   *
   * "Detect gaps in statement sequence numbers and warn. A missing statement is
   * a silently wrong balance." Null when the format does not carry one, which
   * is a reason to warn in itself.
   */
  readonly sequenceNumber: number | null
  readonly openingBalance: bigint
  readonly closingBalance: bigint
  readonly openingDate: string
  readonly closingDate: string
  readonly entries: readonly BankEntry[]
}

export class BankStatementError extends Error {
  constructor(
    readonly detail: string,
    readonly where: string,
  ) {
    super(`${where}: ${detail}`)
    this.name = 'BankStatementError'
  }
}

/**
 * A decimal string to signed minor units, integer arithmetic only.
 *
 * Accepts both separators: MT940 writes `1234,56` and CAMT writes `1234.56`,
 * and a parser that guesses wrong on one of them is off by a factor of a
 * hundred in a way nobody notices until a reconciliation fails.
 */
export function parseBankAmount(value: string, where: string): bigint {
  const cleaned = value.trim().replace(',', '.')
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new BankStatementError(`"${value}" is not an amount.`, where)
  }

  const negative = cleaned.startsWith('-')
  const unsigned = negative ? cleaned.slice(1) : cleaned
  const [whole = '0', fraction = ''] = unsigned.split('.')
  const minorUnits = BigInt(whole + fraction.padEnd(2, '0'))
  return negative ? -minorUnits : minorUnits
}
