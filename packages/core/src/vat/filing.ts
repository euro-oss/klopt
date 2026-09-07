import { violation, LedgerError } from '../errors.js'
import type { FilingTransportKind } from '../ports/filing.js'
import type { VatPeriodKind } from './period.js'
import type { VatFinding, VatReturn } from './return.js'

/**
 * Deciding whether a return may be filed, and whether it is a suppletie.
 *
 * Spec 7.2 gives three rules and this is all three: any difference in the
 * reconciliation is blocking, a filed period is locked, and a correction to a
 * filed period goes out as a suppletie. Nothing here writes anything — it
 * decides, and the repository does as it is told.
 */

/**
 * How the instance reaches the Belastingdienst. Defined by the port, because
 * the transports are adapters — see `ports/filing.ts`.
 */
export type { FilingTransportKind }

export interface FiledSnapshot {
  readonly id: string
  readonly sequence: number
  readonly owedMinorUnits: bigint
  readonly deductibleMinorUnits: bigint
  readonly payableMinorUnits: bigint
}

export interface FilingRequest {
  readonly vatReturn: VatReturn
  readonly kind: VatPeriodKind
  /** The live filing for this period, if the period has been declared before. */
  readonly existing: FiledSnapshot | null
  /**
   * Whether the operator has looked at the warnings and accepted them. Blocking
   * findings can never be accepted, which is what makes them blocking.
   */
  readonly acceptWarnings: boolean
  readonly acceptedReason: string | null
  readonly transport: FilingTransportKind
}

export interface FilingPlan {
  readonly kind: VatPeriodKind
  readonly sequence: number
  readonly supersedesId: string | null
  /** True when this corrects a period that was already declared. */
  readonly isSuppletie: boolean
  /** What changed since the filing being corrected. Empty for a first filing. */
  readonly differences: readonly FilingDifference[]
  readonly acceptedWarnings: readonly VatFinding[]
  readonly transport: FilingTransportKind
}

export interface FilingDifference {
  readonly label: string
  readonly filedMinorUnits: bigint
  readonly nowMinorUnits: bigint
}

export function planFiling(request: FilingRequest): FilingPlan {
  const problems = []
  const blocking = request.vatReturn.findings.filter((finding) => finding.severity === 'blocking')
  const warnings = request.vatReturn.findings.filter((finding) => finding.severity === 'warning')

  if (blocking.length > 0) {
    // Named individually rather than summarised: the operator has to fix each
    // one, and "the reconciliation failed" tells them nothing about which line.
    for (const finding of blocking) {
      problems.push(
        violation('vat_out_of_balance', `findings.${finding.code}`, finding.message, {
          amount: finding.amountMinorUnits.toString(),
          lines: String(finding.lines.length),
        }),
      )
    }
  }

  if (warnings.length > 0 && !request.acceptWarnings) {
    problems.push(
      violation(
        'vat_out_of_balance',
        'acceptWarnings',
        `This return has ${String(warnings.length)} warning(s). Read them and accept them explicitly, with a reason, or fix them.`,
      ),
    )
  }

  if (request.acceptWarnings && (request.acceptedReason ?? '').trim() === '') {
    problems.push(
      violation(
        'vat_out_of_balance',
        'acceptedReason',
        'Accepting a warning needs a reason. It becomes part of the evidence for this period.',
      ),
    )
  }

  const differences: FilingDifference[] = []
  if (request.existing !== null) {
    const compare = (label: string, filedMinorUnits: bigint, nowMinorUnits: bigint): void => {
      if (filedMinorUnits !== nowMinorUnits) {
        differences.push({ label, filedMinorUnits, nowMinorUnits })
      }
    }
    compare(
      '5a Verschuldigde omzetbelasting',
      request.existing.owedMinorUnits,
      request.vatReturn.owedMinorUnits,
    )
    compare(
      '5b Voorbelasting',
      request.existing.deductibleMinorUnits,
      request.vatReturn.deductibleMinorUnits,
    )
    compare(
      '5c Totaal te betalen of terug te vragen',
      request.existing.payableMinorUnits,
      request.vatReturn.payableMinorUnits,
    )

    if (differences.length === 0) {
      problems.push(
        violation(
          'period_already_filed',
          'period',
          'This period has been declared and the figures have not changed. There is nothing to correct, so there is no suppletie to file.',
        ),
      )
    }
  }

  if (problems.length > 0) throw new LedgerError(problems)

  return {
    kind: request.kind,
    sequence: (request.existing?.sequence ?? 0) + 1,
    supersedesId: request.existing?.id ?? null,
    isSuppletie: request.existing !== null,
    differences,
    acceptedWarnings: request.acceptWarnings ? warnings : [],
    transport: request.transport,
  }
}

/**
 * Whether a filed period still says what the journal says.
 *
 * Called on a filed period to answer "does this need a suppletie?". The return
 * is derived, so a correction posted afterwards changes it — and this is how
 * that gets noticed rather than discovered in an audit.
 */
export function suppletieNeeded(
  filed: FiledSnapshot,
  current: VatReturn,
): readonly FilingDifference[] {
  const differences: FilingDifference[] = []
  const compare = (label: string, was: bigint, now: bigint): void => {
    if (was !== now) differences.push({ label, filedMinorUnits: was, nowMinorUnits: now })
  }
  compare('5a Verschuldigde omzetbelasting', filed.owedMinorUnits, current.owedMinorUnits)
  compare('5b Voorbelasting', filed.deductibleMinorUnits, current.deductibleMinorUnits)
  compare(
    '5c Totaal te betalen of terug te vragen',
    filed.payableMinorUnits,
    current.payableMinorUnits,
  )
  return differences
}
