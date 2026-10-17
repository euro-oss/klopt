/**
 * Build a deterministic MT940 statement for the demo bank account.
 *
 * Amounts are minor units (cents). The file must balance: opening + movements
 * = closing, or the import refuses it.
 */

export interface Mt940Line {
  readonly bookingDate: string // YYYY-MM-DD
  /** Signed minor units. Positive is money in. */
  readonly amount: bigint
  readonly counterpartyName: string
  readonly counterpartyIban: string
  readonly remittance: string
  readonly reference: string
}

function yyMmDd(iso: string): string {
  return iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10)
}

/** Entry date on `:61:` is MMDD only (no century year). */
function mmDd(iso: string): string {
  return iso.slice(5, 7) + iso.slice(8, 10)
}

function mtAmount(minor: bigint): string {
  const abs = minor < 0n ? -minor : minor
  const euros = abs / 100n
  const cents = abs % 100n
  return `${euros.toString()},${cents.toString().padStart(2, '0')}`
}

/**
 * One statement covering every line. Sequence 1 on a fresh account.
 */
export function buildMt940(request: {
  readonly iban: string
  readonly openingBalance: bigint
  readonly lines: readonly Mt940Line[]
  readonly statementId?: string
}): { readonly content: string; readonly closingBalance: bigint } {
  let balance = request.openingBalance
  const body: string[] = []

  for (const line of request.lines) {
    balance += line.amount
    const credit = line.amount >= 0n
    const signed = credit ? 'C' : 'D'
    const abs = credit ? line.amount : -line.amount
    const yymmdd = yyMmDd(line.bookingDate)
    body.push(
      `:61:${yymmdd}${mmDd(line.bookingDate)}${signed}${mtAmount(abs)}NTRFNONREF//${line.reference}`,
    )
    body.push(
      `:86:/EREF/${line.reference}/IBAN/${line.counterpartyIban}/NAME/${line.counterpartyName}/REMI/${line.remittance}`,
    )
  }

  const first = request.lines[0]?.bookingDate ?? '2025-01-02'
  const last = request.lines[request.lines.length - 1]?.bookingDate ?? first
  const openingSign = request.openingBalance >= 0n ? 'C' : 'D'
  const closingSign = balance >= 0n ? 'C' : 'D'
  const openingAbs = request.openingBalance < 0n ? -request.openingBalance : request.openingBalance
  const closingAbs = balance < 0n ? -balance : balance

  const content = [
    ':20:' + (request.statementId ?? 'STMT-DEMO-2025'),
    `:25:${request.iban} EUR`,
    ':28C:1/1',
    `:60F:${openingSign}${yyMmDd(first)}EUR${mtAmount(openingAbs)}`,
    ...body,
    `:62F:${closingSign}${yyMmDd(last)}EUR${mtAmount(closingAbs)}`,
    '-',
    '',
  ].join('\n')

  return { content, closingBalance: balance }
}
