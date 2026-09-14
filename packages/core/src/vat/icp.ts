import { LedgerError, forwarded, type LedgerViolation } from '../errors.js'
import { isEuVatCountry, parseVatNumber } from '../ports/vat-number.js'
import { feedsIcp, ruleInForce, type TaxCodeRule } from './tax-code.js'
import type { VatJournalLine, VatLineContribution, VatReturn } from './return.js'
import { renderFindingMessage, type FindingMessageKey } from '../finding-messages.js'

/**
 * The ICP opgaaf (spec 7.2).
 *
 * "Per period, per counterparty VAT number, totals for goods and services."
 * Plus the check that makes it worth having: "ICP totals must equal rubriek 3b.
 * Block on mismatch."
 *
 * That cross-check is the interesting part. The aangifte and the opgaaf are two
 * filings that describe the same supplies from different angles — one by rate,
 * one by counterparty — and the Belastingdienst reconciles them against each
 * other and against what the other member state's customer declared. A
 * difference between your own two filings is the easiest possible finding, so
 * it is caught here rather than in a letter.
 *
 * Both are derived from the same journal lines, which is why they *can* agree:
 * the opgaaf groups the 3b lines by counterparty and the aangifte sums them.
 * If they differ, some 3b line has no counterparty on it — and that is a real
 * problem, because a zero-rated supply with no known customer is not a
 * zero-rated supply.
 */

export interface IcpCounterparty {
  readonly vatNumber: string
  readonly countryCode: string
  readonly contactNumber: string | null
  readonly contactName: string | null
}

/** The proof that the number was good, as stored. See `ports/vat-number.ts`. */
export interface IcpProof {
  readonly outcome: 'valid' | 'invalid' | 'unavailable'
  readonly checkedAt: string
  readonly requestIdentifier: string | null
  readonly source: string
}

export interface IcpEntry {
  readonly vatNumber: string
  readonly countryCode: string
  readonly contactNumber: string | null
  readonly contactName: string | null
  readonly goodsMinorUnits: bigint
  readonly servicesMinorUnits: bigint
  readonly totalMinorUnits: bigint
  readonly proof: IcpProof | null
  readonly lines: readonly VatLineContribution[]
}

export type IcpFindingCode =
  | 'supply_without_counterparty'
  | 'counterparty_without_vat_number'
  | 'vat_number_not_eu'
  | 'vat_number_malformed'
  | 'vat_number_invalid'
  | 'vat_number_unproven'
  | 'proof_predates_period'
  | 'icp_mismatch'

export interface IcpFinding {
  readonly code: IcpFindingCode
  readonly severity: 'blocking' | 'warning'
  readonly message: string
  /** Which sentence this is, and the values in it, for a client that translates. */
  readonly messageKey: FindingMessageKey
  readonly detail?: Readonly<Record<string, string>>
  readonly amountMinorUnits: bigint
  readonly lines: readonly VatLineContribution[]
}

export interface IcpReturn {
  readonly periodFrom: string
  readonly periodTo: string
  readonly entries: readonly IcpEntry[]
  readonly goodsMinorUnits: bigint
  readonly servicesMinorUnits: bigint
  readonly totalMinorUnits: bigint
  /** What the aangifte declares in 3b. The two must be equal. */
  readonly rubriek3bMinorUnits: bigint
  readonly differenceMinorUnits: bigint
  readonly findings: readonly IcpFinding[]
  readonly blocked: boolean
}

/** A journal line with the counterparty its subledger link resolves to. */
export interface IcpJournalLine extends VatJournalLine {
  readonly counterpartyNumber: string | null
  readonly counterpartyName: string | null
  readonly counterpartyVatNumber: string | null
  readonly counterpartyCountryCode: string | null
}

export interface IcpRequest {
  readonly periodFrom: string
  readonly periodTo: string
  readonly lines: readonly IcpJournalLine[]
  readonly rules: readonly TaxCodeRule[]
  /** The BTW-aangifte for the same period, for the 3b cross-check. */
  readonly vatReturn: VatReturn
  /** The most recent VIES answer per normalised VAT number. */
  readonly proofs: ReadonlyMap<string, IcpProof>
}

function contributionOf(
  line: IcpJournalLine,
  taxCode: string,
  amountMinorUnits: bigint,
): VatLineContribution {
  return {
    entryId: line.entryId,
    entryNumber: line.entryNumber,
    journalCode: line.journalCode,
    bookingDate: line.bookingDate,
    lineNumber: line.lineNumber,
    accountNumber: line.accountNumber,
    accountName: line.accountName,
    description: line.description,
    taxCode,
    taxRole: 'base',
    amountMinorUnits,
  }
}

export function buildIcpReturn(request: IcpRequest): IcpReturn {
  const byNumber = new Map<
    string,
    {
      counterparty: IcpCounterparty
      goods: bigint
      services: bigint
      lines: VatLineContribution[]
    }
  >()
  const problems = new Map<IcpFindingCode, { amount: bigint; lines: VatLineContribution[] }>()

  const flag = (code: IcpFindingCode, line: VatLineContribution): void => {
    let found = problems.get(code)
    if (found === undefined) {
      found = { amount: 0n, lines: [] }
      problems.set(code, found)
    }
    found.amount += line.amountMinorUnits
    found.lines.push(line)
  }

  for (const line of request.lines) {
    if (line.taxCode === null || line.taxRole !== 'base') continue
    const rule = ruleInForce(request.rules, line.taxCode, line.bookingDate)
    if (rule === undefined || !feedsIcp(rule)) continue

    // An intra-community supply is an output code, so its base was credited.
    const amount = -line.signedMinorUnits
    const contribution = contributionOf(line, rule.code, amount)

    if (line.counterpartyNumber === null) {
      // No subledger link at all. This is the case that makes the opgaaf
      // disagree with 3b, and there is nothing to do but name the entry.
      flag('supply_without_counterparty', contribution)
      continue
    }
    if (line.counterpartyVatNumber === null || line.counterpartyVatNumber.trim() === '') {
      flag('counterparty_without_vat_number', contribution)
      continue
    }

    const parsed = parseVatNumber(line.counterpartyVatNumber)
    if (parsed === null) {
      flag(
        isEuVatCountry(line.counterpartyVatNumber.slice(0, 2))
          ? 'vat_number_malformed'
          : 'vat_number_not_eu',
        contribution,
      )
      continue
    }

    let seat = byNumber.get(parsed.normalised)
    if (seat === undefined) {
      seat = {
        counterparty: {
          vatNumber: parsed.normalised,
          countryCode: parsed.countryCode,
          contactNumber: line.counterpartyNumber,
          contactName: line.counterpartyName,
        },
        goods: 0n,
        services: 0n,
        lines: [],
      }
      byNumber.set(parsed.normalised, seat)
    }

    if (rule.supplyKind === 'services') seat.services += amount
    else seat.goods += amount
    seat.lines.push(contribution)
  }

  const entries: IcpEntry[] = [...byNumber.values()]
    .map((seat) => ({
      vatNumber: seat.counterparty.vatNumber,
      countryCode: seat.counterparty.countryCode,
      contactNumber: seat.counterparty.contactNumber,
      contactName: seat.counterparty.contactName,
      goodsMinorUnits: seat.goods,
      servicesMinorUnits: seat.services,
      totalMinorUnits: seat.goods + seat.services,
      proof: request.proofs.get(seat.counterparty.vatNumber) ?? null,
      lines: seat.lines,
    }))
    .sort((a, b) => a.vatNumber.localeCompare(b.vatNumber))

  // The proof, per counterparty. Not a line-level problem, so it is checked
  // after the grouping rather than inside it.
  for (const entry of entries) {
    if (entry.proof === null) {
      for (const line of entry.lines) flag('vat_number_unproven', line)
      continue
    }
    if (entry.proof.outcome === 'invalid') {
      for (const line of entry.lines) flag('vat_number_invalid', line)
      continue
    }
    if (entry.proof.outcome === 'unavailable') {
      for (const line of entry.lines) flag('vat_number_unproven', line)
      continue
    }
    // A check made before the supply proves nothing about the supply: a number
    // can be deregistered. The rule is that the proof is dated on or after the
    // period the supply falls in.
    if (entry.proof.checkedAt.slice(0, 10) < request.periodFrom) {
      for (const line of entry.lines) flag('proof_predates_period', line)
    }
  }

  const goods = entries.reduce((sum, entry) => sum + entry.goodsMinorUnits, 0n)
  const services = entries.reduce((sum, entry) => sum + entry.servicesMinorUnits, 0n)
  const total = goods + services

  const rubriek3b =
    request.vatReturn.rubrieken.find((entry) => entry.rubriek.id === '3b')?.baseMinorUnits ?? 0n

  const KINDS: readonly {
    code: IcpFindingCode
    severity: 'blocking' | 'warning'
    message: string
    messageKey: FindingMessageKey
  }[] = [
    {
      code: 'supply_without_counterparty',
      severity: 'blocking',
      message: renderFindingMessage('icp.supply_without_counterparty'),
      messageKey: 'icp.supply_without_counterparty',
    },
    {
      code: 'counterparty_without_vat_number',
      severity: 'blocking',
      message: renderFindingMessage('icp.counterparty_without_vat_number'),
      messageKey: 'icp.counterparty_without_vat_number',
    },
    {
      code: 'vat_number_malformed',
      severity: 'blocking',
      message: renderFindingMessage('icp.vat_number_malformed'),
      messageKey: 'icp.vat_number_malformed',
    },
    {
      code: 'vat_number_not_eu',
      severity: 'blocking',
      message: renderFindingMessage('icp.vat_number_not_eu'),
      messageKey: 'icp.vat_number_not_eu',
    },
    {
      code: 'vat_number_invalid',
      severity: 'blocking',
      message: renderFindingMessage('icp.vat_number_invalid'),
      messageKey: 'icp.vat_number_invalid',
    },
    {
      code: 'vat_number_unproven',
      severity: 'blocking',
      message: renderFindingMessage('icp.vat_number_unproven'),
      messageKey: 'icp.vat_number_unproven',
    },
    {
      code: 'proof_predates_period',
      severity: 'warning',
      message: renderFindingMessage('icp.proof_predates_period'),
      messageKey: 'icp.proof_predates_period',
    },
  ]

  const findings: IcpFinding[] = []
  for (const kind of KINDS) {
    const found = problems.get(kind.code)
    if (found === undefined) continue
    findings.push({
      code: kind.code,
      severity: kind.severity,
      message: kind.message,
      messageKey: kind.messageKey,
      amountMinorUnits: found.amount,
      lines: found.lines,
    })
  }

  const difference = total - rubriek3b
  if (difference !== 0n) {
    findings.push({
      code: 'icp_mismatch',
      severity: 'blocking',
      message: renderFindingMessage('icp.icp_mismatch', {
        total: total.toString(),
        rubriek3b: rubriek3b.toString(),
      }),
      messageKey: 'icp.icp_mismatch',
      detail: { total: total.toString(), rubriek3b: rubriek3b.toString() },
      amountMinorUnits: difference,
      lines: [],
    })
  }

  const order = { blocking: 0, warning: 1 } as const
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code))

  return {
    periodFrom: request.periodFrom,
    periodTo: request.periodTo,
    entries,
    goodsMinorUnits: goods,
    servicesMinorUnits: services,
    totalMinorUnits: total,
    rubriek3bMinorUnits: rubriek3b,
    differenceMinorUnits: difference,
    findings,
    blocked: findings.some((finding) => finding.severity === 'blocking'),
  }
}

/** Refuse to file an opgaaf that does not reconcile. Spec 7.2: block on mismatch. */
export function assertIcpFileable(icp: IcpReturn): void {
  const problems: LedgerViolation[] = icp.findings
    .filter((finding) => finding.severity === 'blocking')
    .map((finding) =>
      forwarded('icp_mismatch', `icp.${finding.code}`, finding.message, finding.messageKey, {
        code: finding.code,
        amount: finding.amountMinorUnits.toString(),
        lines: String(finding.lines.length),
      }),
    )

  if (problems.length > 0) throw new LedgerError(problems)
}
