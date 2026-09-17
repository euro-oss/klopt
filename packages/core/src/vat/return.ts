import type { TaxRole } from '../ledger/types.js'
import { OWED_RUBRIEKEN, RUBRIEKEN, findRubriek, type Rubriek } from './rubrieken.js'
import { ruleInForce, type TaxCodeRule } from './tax-code.js'
import { renderFindingMessage, type FindingMessageKey } from '../finding-messages.js'

/**
 * The BTW-aangifte, derived from the journal.
 *
 * Spec 7.2, and the reason this module is shaped the way it is: "Generate the
 * return from the journal, never from a parallel tally. A VAT reconciliation
 * report must show, for each rubriek, the exact journal lines that produced it,
 * and must reconcile the VAT control accounts to the declared amounts. Any
 * difference is blocking."
 *
 * So there is no `vat_totals` table and never will be. The return is a pure
 * function of the period's journal lines and the tax codes in force, and it is
 * recomputed every time it is looked at. Two consequences worth stating:
 *
 *   - A correction posted after filing changes what the function returns. That
 *     is not a bug; it is the signal that a suppletie is owed, and comparing
 *     the filed snapshot against a fresh computation is how we find it.
 *   - Nothing can be declared that is not in the books. A figure typed into a
 *     box would have no journal lines behind it, so the reconciliation would
 *     refuse it.
 *
 * **Where the base comes from.** A journal line says whether it is the taxable
 * base or the tax itself (`taxRole`), and both carry the tax code. Without that
 * the base is unrecoverable: 1a needs the omzet, and "the credit lines of an
 * entry that has a tax line" is a guess that breaks on the first entry mixing
 * two rates on one revenue account.
 *
 * **Signs.** Journal lines arrive signed as debit minus credit, and every box
 * on the form is meant to read positive in an ordinary quarter. Which side a
 * line sits on is not a property of the tax code but of the line's role:
 *
 *   - A **base** line is revenue on a sale (credit) and a cost on a purchase
 *     (debit), so it follows the code's direction.
 *   - A **tax** line is a credit when the VAT is owed and a debit when it is
 *     deductible, so it follows the *rubriek's* role.
 *
 * The two can disagree within one tax code, which is why this is not a single
 * flip per code. An intra-community acquisition declares a base in 4b that was
 * debited as a cost and VAT in 4b that was credited as a liability — flipping
 * both the same way would report the base as negative.
 *
 * A credit note lands negative throughout and reduces the box, which is what
 * it should do.
 */

export type { TaxRole }

export interface VatJournalLine {
  readonly entryId: string
  readonly entryNumber: string
  readonly journalCode: string
  readonly bookingDate: string
  readonly lineNumber: number
  readonly accountNumber: string
  readonly accountName: string
  readonly description: string
  readonly taxCode: string | null
  readonly taxRole: TaxRole | null
  /** Debit minus credit, in minor units. */
  readonly signedMinorUnits: bigint
}

/** A line as it appears in the reconciliation report, with its contribution. */
export interface VatLineContribution {
  readonly entryId: string
  readonly entryNumber: string
  readonly journalCode: string
  readonly bookingDate: string
  readonly lineNumber: number
  readonly accountNumber: string
  readonly accountName: string
  readonly description: string
  readonly taxCode: string
  readonly taxRole: TaxRole
  /** Signed as declared: positive increases the box. */
  readonly amountMinorUnits: bigint
}

export interface RubriekTotal {
  readonly rubriek: Rubriek
  readonly baseMinorUnits: bigint
  readonly vatMinorUnits: bigint
  /** Every line behind the two figures above. The audit trail, not a sample. */
  readonly lines: readonly VatLineContribution[]
}

export type VatFindingCode =
  | 'unknown_tax_code'
  | 'no_rule_in_force'
  | 'code_declares_no_vat'
  | 'code_declares_no_base'
  | 'untagged_control_movement'
  | 'rate_mismatch'
  | 'control_account_difference'

export interface VatFinding {
  readonly code: VatFindingCode
  /** Blocking stops the filing. A warning is shown and can be accepted. */
  readonly severity: 'blocking' | 'warning'
  readonly message: string
  /** Which sentence this is, and the values in it, for a client that translates. */
  readonly messageKey: FindingMessageKey
  readonly detail?: Readonly<Record<string, string>>
  readonly amountMinorUnits: bigint
  readonly lines: readonly VatLineContribution[]
}

export interface ControlAccountReconciliation {
  readonly accountNumber: string
  readonly accountName: string
  /** The period's movement of lines on this account that carry a tax code. */
  readonly taggedMovementMinorUnits: bigint
  /** What the return declares from those same lines. */
  readonly declaredMinorUnits: bigint
  readonly differenceMinorUnits: bigint
  /** Movement with no tax code — a payment to the Belastingdienst, or a slip. */
  readonly untaggedMovementMinorUnits: bigint
}

export interface VatReturn {
  readonly periodFrom: string
  readonly periodTo: string
  readonly rubrieken: readonly RubriekTotal[]
  /** Rubriek 5a: what is owed. */
  readonly owedMinorUnits: bigint
  /** Rubriek 5b: voorbelasting. */
  readonly deductibleMinorUnits: bigint
  /** Rubriek 5c: positive is payable, negative is a refund. */
  readonly payableMinorUnits: bigint
  readonly reconciliation: readonly ControlAccountReconciliation[]
  readonly findings: readonly VatFinding[]
  /** Whether anything blocking was found. Filing is refused while true. */
  readonly blocked: boolean
}

export interface VatReturnRequest {
  readonly periodFrom: string
  readonly periodTo: string
  readonly lines: readonly VatJournalLine[]
  readonly rules: readonly TaxCodeRule[]
  /**
   * The accounts VAT is posted to. Movements here without a tax code are
   * reported, because that is where a hand-typed correction hides.
   */
  readonly controlAccountNumbers: readonly string[]
}

function contribution(
  line: VatJournalLine,
  taxCode: string,
  taxRole: TaxRole,
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
    taxRole,
    amountMinorUnits,
  }
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

export function buildVatReturn(request: VatReturnRequest): VatReturn {
  const totals = new Map<string, { base: bigint; vat: bigint; lines: VatLineContribution[] }>()
  const findings: VatFinding[] = []

  const bucket = (id: string) => {
    let found = totals.get(id)
    if (found === undefined) {
      found = { base: 0n, vat: 0n, lines: [] }
      totals.set(id, found)
    }
    return found
  }

  const controlAccounts = new Set(request.controlAccountNumbers)
  const control = new Map<
    string,
    { name: string; tagged: bigint; declared: bigint; untagged: bigint }
  >()
  const controlBucket = (accountNumber: string, accountName: string) => {
    let found = control.get(accountNumber)
    if (found === undefined) {
      found = { name: accountName, tagged: 0n, declared: 0n, untagged: 0n }
      control.set(accountNumber, found)
    }
    return found
  }

  const excluded = new Map<VatFindingCode, { amount: bigint; lines: VatLineContribution[] }>()
  const exclude = (
    code: VatFindingCode,
    line: VatJournalLine,
    taxCode: string,
    role: TaxRole,
    amount: bigint,
  ) => {
    let found = excluded.get(code)
    if (found === undefined) {
      found = { amount: 0n, lines: [] }
      excluded.set(code, found)
    }
    found.amount += amount
    found.lines.push(contribution(line, taxCode, role, amount))
  }

  // Ordered so the reconciliation report reads like a journal rather than a
  // hash map: by date, then entry, then line.
  const ordered = [...request.lines].sort(
    (a, b) =>
      a.bookingDate.localeCompare(b.bookingDate) ||
      a.entryNumber.localeCompare(b.entryNumber) ||
      a.lineNumber - b.lineNumber,
  )

  for (const line of ordered) {
    const onControlAccount = controlAccounts.has(line.accountNumber)

    if (line.taxCode === null || line.taxRole === null) {
      if (onControlAccount && line.signedMinorUnits !== 0n) {
        const seat = controlBucket(line.accountNumber, line.accountName)
        seat.untagged += line.signedMinorUnits
        exclude('untagged_control_movement', line, '—', 'tax', line.signedMinorUnits)
      }
      continue
    }

    const rule = ruleInForce(request.rules, line.taxCode, line.bookingDate)
    if (rule === undefined) {
      const known = request.rules.some((entry) => entry.code === line.taxCode)
      const code: VatFindingCode = known ? 'no_rule_in_force' : 'unknown_tax_code'
      exclude(code, line, line.taxCode, line.taxRole, line.signedMinorUnits)
      if (onControlAccount) {
        controlBucket(line.accountNumber, line.accountName).tagged += line.signedMinorUnits
      }
      continue
    }

    if (onControlAccount) {
      controlBucket(line.accountNumber, line.accountName).tagged += line.signedMinorUnits
    }

    if (line.taxRole === 'tax') {
      if (rule.vatRubriek === null) {
        exclude('code_declares_no_vat', line, rule.code, 'tax', line.signedMinorUnits)
        continue
      }
      const box = findRubriek(rule.vatRubriek)
      // Owed VAT was credited, deductible VAT was debited. See the note on
      // signs at the top of the file.
      const natural = box?.role === 'owed' ? -line.signedMinorUnits : line.signedMinorUnits
      const seat = bucket(rule.vatRubriek)
      seat.vat += natural
      seat.lines.push(contribution(line, rule.code, 'tax', natural))
      if (onControlAccount) {
        controlBucket(line.accountNumber, line.accountName).declared += line.signedMinorUnits
      }
      continue
    }

    // A base is revenue on a sale and a cost on a purchase.
    const natural = rule.direction === 'output' ? -line.signedMinorUnits : line.signedMinorUnits

    if (rule.baseRubriek === null) {
      // A code whose VAT lands in 5b has no base box on the form, so its base
      // lines are expected and reporting them would put a warning on every
      // return that has a single purchase in it. They are still tagged, because
      // XAF wants the base alongside the VAT.
      //
      // Any *other* code with no base box is an out-of-scope code, and a
      // taxable base tagged with one is worth saying out loud.
      if (rule.vatRubriek !== '5b') {
        exclude('code_declares_no_base', line, rule.code, 'base', natural)
      }
      continue
    }
    const seat = bucket(rule.baseRubriek)
    seat.base += natural
    seat.lines.push(contribution(line, rule.code, 'base', natural))
  }

  const rubrieken: RubriekTotal[] = RUBRIEKEN.filter((entry) => !entry.computed).map((entry) => {
    const seat = totals.get(entry.id)
    return {
      rubriek: entry,
      baseMinorUnits: seat?.base ?? 0n,
      vatMinorUnits: seat?.vat ?? 0n,
      lines: seat?.lines ?? [],
    }
  })

  const byId = new Map(rubrieken.map((entry) => [entry.rubriek.id, entry]))
  const owed = OWED_RUBRIEKEN.reduce((sum, id) => sum + (byId.get(id)?.vatMinorUnits ?? 0n), 0n)
  const deductible = byId.get('5b')?.vatMinorUnits ?? 0n

  // Every rubriek with both a base and VAT is checked against its own rate. A
  // mismatch is a manual override somewhere, which is legitimate — a rounding
  // correction, a prior-period adjustment booked by hand — so it is a warning
  // with the difference named, not a refusal.
  for (const total of rubrieken) {
    if (total.rubriek.carries !== 'both') continue
    if (total.baseMinorUnits === 0n && total.vatMinorUnits === 0n) continue

    let expected = 0n
    let rateKnown = true
    for (const line of total.lines) {
      if (line.taxRole !== 'base') continue
      const rule = ruleInForce(request.rules, line.taxCode, line.bookingDate)
      if (rule === undefined) {
        rateKnown = false
        break
      }
      expected += (line.amountMinorUnits * BigInt(rule.rateBasisPoints)) / 10_000n
    }
    if (!rateKnown) continue

    const drift = total.vatMinorUnits - expected
    // One cent of slack per contributing line: per-line rounding is legitimate
    // and the return rounds once more on top of it.
    const slack = BigInt(Math.max(1, total.lines.length))
    if (abs(drift) > slack) {
      findings.push({
        code: 'rate_mismatch',
        severity: 'warning',
        message: renderFindingMessage('vat.rate_mismatch', {
          id: total.rubriek.id,
          expected: expected.toString(),
          vatMinorUnits: total.vatMinorUnits.toString(),
        }),
        messageKey: 'vat.rate_mismatch',
        detail: {
          id: total.rubriek.id,
          expected: expected.toString(),
          vatMinorUnits: total.vatMinorUnits.toString(),
        },
        amountMinorUnits: drift,
        lines: total.lines,
      })
    }
  }

  const reconciliation: ControlAccountReconciliation[] = [...control.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([accountNumber, seat]) => ({
      accountNumber,
      accountName: seat.name,
      taggedMovementMinorUnits: seat.tagged,
      declaredMinorUnits: seat.declared,
      differenceMinorUnits: seat.tagged - seat.declared,
      untaggedMovementMinorUnits: seat.untagged,
    }))

  const EXCLUSIONS: readonly {
    code: VatFindingCode
    severity: 'blocking' | 'warning'
    message: string
    messageKey: FindingMessageKey
  }[] = [
    {
      code: 'unknown_tax_code',
      severity: 'blocking',
      message: renderFindingMessage('vat.unknown_tax_code'),
      messageKey: 'vat.unknown_tax_code',
    },
    {
      code: 'no_rule_in_force',
      severity: 'blocking',
      message: renderFindingMessage('vat.no_rule_in_force'),
      messageKey: 'vat.no_rule_in_force',
    },
    {
      code: 'code_declares_no_vat',
      severity: 'blocking',
      message: renderFindingMessage('vat.code_declares_no_vat'),
      messageKey: 'vat.code_declares_no_vat',
    },
    {
      code: 'code_declares_no_base',
      severity: 'warning',
      message: renderFindingMessage('vat.code_declares_no_base'),
      messageKey: 'vat.code_declares_no_base',
    },
    {
      code: 'untagged_control_movement',
      severity: 'warning',
      message: renderFindingMessage('vat.untagged_control_movement'),
      messageKey: 'vat.untagged_control_movement',
    },
  ]

  for (const kind of EXCLUSIONS) {
    const found = excluded.get(kind.code)
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

  for (const account of reconciliation) {
    if (account.differenceMinorUnits === 0n) continue
    findings.push({
      code: 'control_account_difference',
      severity: 'blocking',
      message: renderFindingMessage('vat.control_account_difference', {
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        taggedMovementMinorUnits: account.taggedMovementMinorUnits.toString(),
        declaredMinorUnits: account.declaredMinorUnits.toString(),
      }),
      messageKey: 'vat.control_account_difference',
      detail: {
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        taggedMovementMinorUnits: account.taggedMovementMinorUnits.toString(),
        declaredMinorUnits: account.declaredMinorUnits.toString(),
      },
      amountMinorUnits: account.differenceMinorUnits,
      lines: [],
    })
  }

  const order: Record<'blocking' | 'warning', number> = { blocking: 0, warning: 1 }
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code))

  return {
    periodFrom: request.periodFrom,
    periodTo: request.periodTo,
    rubrieken,
    owedMinorUnits: owed,
    deductibleMinorUnits: deductible,
    payableMinorUnits: owed - deductible,
    reconciliation,
    findings,
    blocked: findings.some((finding) => finding.severity === 'blocking'),
  }
}

/** The figure for a box, for display and for the XBRL instance. */
export function rubriekAmounts(
  vatReturn: VatReturn,
  id: string,
): { baseMinorUnits: bigint; vatMinorUnits: bigint } {
  if (id === '5a') return { baseMinorUnits: 0n, vatMinorUnits: vatReturn.owedMinorUnits }
  if (id === '5c') return { baseMinorUnits: 0n, vatMinorUnits: vatReturn.payableMinorUnits }
  const found = vatReturn.rubrieken.find((entry) => entry.rubriek.id === id)
  return {
    baseMinorUnits: found?.baseMinorUnits ?? 0n,
    vatMinorUnits: found?.vatMinorUnits ?? 0n,
  }
}

/** Every box in form order, subtotals included, for rendering the return. */
export function presentVatReturn(
  vatReturn: VatReturn,
): readonly { rubriek: Rubriek; baseMinorUnits: bigint; vatMinorUnits: bigint }[] {
  return RUBRIEKEN.map((entry) => ({
    rubriek: findRubriek(entry.id) ?? entry,
    ...rubriekAmounts(vatReturn, entry.id),
  }))
}
