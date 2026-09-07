import {
  parseVatPeriodCode,
  planFiling,
  presentVatReturn,
  suppletieNeeded,
  vatDeadline,
  vatPeriodsIn,
  type IcpFinding,
  type VatFinding,
  type VatPeriod,
  type VatReturn,
} from '@klopt/core'
import { withVat, withVatFiling, withVatRead } from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import type { CheckVatNumbersBody, FileVatReturnBody, ListVatPeriodsQuery } from '../schemas.js'
import { vatNumberValidator } from '../vat-number.js'

/**
 * The BTW-aangifte over HTTP.
 *
 * Every read recomputes the return from the journal. There is no cache and no
 * stored total to serve instead, which is the whole point of spec 7.2's "never
 * from a parallel tally" — a stale figure and a wrong figure are the same
 * thing to the Belastingdienst.
 */

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

function requireIdempotencyKey(context: RequestContext): string {
  if (context.idempotencyKey === null || context.idempotencyKey === '') {
    throw new ApiError('idempotency_key_required', 'Every write needs an Idempotency-Key header.')
  }
  return context.idempotencyKey
}

function serialiseFinding(finding: VatFinding) {
  return {
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    amount: finding.amountMinorUnits.toString(),
    lines: finding.lines.map((line) => ({
      entryId: line.entryId,
      entryNumber: line.entryNumber,
      journalCode: line.journalCode,
      bookingDate: line.bookingDate,
      lineNumber: line.lineNumber,
      accountNumber: line.accountNumber,
      accountName: line.accountName,
      description: line.description,
      taxCode: line.taxCode,
      taxRole: line.taxRole,
      amount: line.amountMinorUnits.toString(),
    })),
  }
}

function serialiseReturn(vatReturn: VatReturn, period: VatPeriod) {
  return {
    period: {
      code: period.code,
      label: period.label,
      kind: period.kind,
      from: period.from,
      to: period.to,
      deadline: vatDeadline(period),
    },
    // In form order with the subtotals filled in, so a client can render the
    // aangifte without knowing how 5a is computed.
    rubrieken: presentVatReturn(vatReturn).map((row) => ({
      id: row.rubriek.id,
      section: row.rubriek.section,
      label: row.rubriek.label,
      carries: row.rubriek.carries,
      computed: row.rubriek.computed,
      base: row.baseMinorUnits.toString(),
      vat: row.vatMinorUnits.toString(),
    })),
    owed: vatReturn.owedMinorUnits.toString(),
    deductible: vatReturn.deductibleMinorUnits.toString(),
    payable: vatReturn.payableMinorUnits.toString(),
    reconciliation: vatReturn.reconciliation.map((account) => ({
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      taggedMovement: account.taggedMovementMinorUnits.toString(),
      declared: account.declaredMinorUnits.toString(),
      difference: account.differenceMinorUnits.toString(),
      untaggedMovement: account.untaggedMovementMinorUnits.toString(),
    })),
    findings: vatReturn.findings.map(serialiseFinding),
    blocked: vatReturn.blocked,
  }
}

/** Every line behind a rubriek, which is what makes the report an audit trail. */
function serialiseLines(vatReturn: VatReturn) {
  return vatReturn.rubrieken
    .filter((total) => total.lines.length > 0)
    .map((total) => ({
      rubriek: total.rubriek.id,
      base: total.baseMinorUnits.toString(),
      vat: total.vatMinorUnits.toString(),
      lines: total.lines.map((line) => ({
        entryId: line.entryId,
        entryNumber: line.entryNumber,
        journalCode: line.journalCode,
        bookingDate: line.bookingDate,
        lineNumber: line.lineNumber,
        accountNumber: line.accountNumber,
        accountName: line.accountName,
        description: line.description,
        taxCode: line.taxCode,
        taxRole: line.taxRole,
        amount: line.amountMinorUnits.toString(),
      })),
    }))
}

export async function handleListVatPeriods(context: RequestContext, query: ListVatPeriodsQuery) {
  requirePermission(context, 'ledger:read')

  return withVatRead(context.database, async (repository) => {
    const kind = await repository.periodKind(context.entityId)
    const periods = vatPeriodsIn(kind, query.year)
    const filings = await repository.filings(context.entityId)

    return {
      status: 200,
      body: {
        kind,
        year: query.year,
        periods: periods.map((period) => {
          const filed = filings.filter(
            (filing) =>
              filing.periodFrom === period.from &&
              filing.periodTo === period.to &&
              filing.state !== 'superseded',
          )
          const live = filed[filed.length - 1]
          return {
            code: period.code,
            label: period.label,
            from: period.from,
            to: period.to,
            deadline: vatDeadline(period),
            filed: live !== undefined,
            sequence: live?.sequence ?? 0,
            filedAt: live?.filedAt?.toISOString() ?? null,
            payable: live?.payable.toString() ?? null,
          }
        }),
      },
    }
  })
}

export async function handleGetVatReturn(context: RequestContext, periodCode: string) {
  requirePermission(context, 'ledger:read')
  const period = parseVatPeriodCode(periodCode)

  return withVatRead(context.database, async (repository) => {
    const vatReturn = await repository.buildReturn({
      entityId: context.entityId,
      from: period.from,
      to: period.to,
    })
    const existing = await repository.filingForPeriod(context.entityId, period.from, period.to)
    const filed = existing === null ? null : await repository.filing(context.entityId, existing.id)

    return {
      status: 200,
      body: {
        ...serialiseReturn(vatReturn, period),
        detail: serialiseLines(vatReturn),
        filing:
          filed === null
            ? null
            : {
                id: filed.id,
                sequence: filed.sequence,
                state: filed.state,
                filedAt: filed.filedAt?.toISOString() ?? null,
                filedBy: filed.filedBy,
                transport: filed.transport,
                owed: filed.owedMinorUnits.toString(),
                deductible: filed.deductibleMinorUnits.toString(),
                payable: filed.payableMinorUnits.toString(),
                // The reason this snapshot is kept at all: the return is
                // derived, so a correction posted afterwards moves it.
                suppletieNeeded: suppletieNeeded(
                  {
                    id: filed.id,
                    sequence: filed.sequence,
                    owedMinorUnits: filed.owedMinorUnits,
                    deductibleMinorUnits: filed.deductibleMinorUnits,
                    payableMinorUnits: filed.payableMinorUnits,
                  },
                  vatReturn,
                ).map((difference) => ({
                  label: difference.label,
                  filed: difference.filedMinorUnits.toString(),
                  now: difference.nowMinorUnits.toString(),
                })),
              },
      },
    }
  })
}

export async function handleListVatFilings(context: RequestContext) {
  requirePermission(context, 'ledger:read')

  return withVatRead(context.database, async (repository) => {
    const filings = await repository.filings(context.entityId)
    return {
      status: 200,
      body: {
        filings: filings.map((filing) => ({
          id: filing.id,
          periodFrom: filing.periodFrom,
          periodTo: filing.periodTo,
          kind: filing.kind,
          state: filing.state,
          sequence: filing.sequence,
          owed: filing.owed.toString(),
          deductible: filing.deductible.toString(),
          payable: filing.payable.toString(),
          filedAt: filing.filedAt?.toISOString() ?? null,
          filedBy: filing.filedBy,
          transport: filing.transport,
          transportReference: filing.transportReference,
        })),
      },
    }
  })
}

export async function handleFileVatReturn(context: RequestContext, body: FileVatReturnBody) {
  requirePermission(context, 'vat:file')
  requireIdempotencyKey(context)
  const period = parseVatPeriodCode(body.period)

  return withVatFiling(context.database, async ({ vat }) => {
    const vatReturn = await vat.buildReturn({
      entityId: context.entityId,
      from: period.from,
      to: period.to,
    })
    const live = await vat.filingForPeriod(context.entityId, period.from, period.to)
    const existing = live === null ? null : await vat.filing(context.entityId, live.id)

    // `planFiling` throws a LedgerError carrying every reason at once, which the
    // runtime turns into a 422 naming each. Nothing is written until it returns.
    const plan = planFiling({
      vatReturn,
      kind: period.kind,
      existing:
        existing === null
          ? null
          : {
              id: existing.id,
              sequence: existing.sequence,
              owedMinorUnits: existing.owedMinorUnits,
              deductibleMinorUnits: existing.deductibleMinorUnits,
              payableMinorUnits: existing.payableMinorUnits,
            },
      acceptWarnings: body.acceptWarnings,
      acceptedReason: body.acceptedReason,
      transport: body.transport,
    })

    const id = await vat.recordFiling({
      entityId: context.entityId,
      vatReturn,
      kind: plan.kind,
      sequence: plan.sequence,
      supersedesId: plan.supersedesId,
      filedBy: context.actor.id,
      transport: plan.transport,
      transportReference: body.transportReference,
      acceptedWarningsBy: plan.acceptedWarnings.length > 0 ? context.actor.id : null,
      acceptedWarningsReason: plan.acceptedWarnings.length > 0 ? body.acceptedReason : null,
    })

    // Spec 7.2: lock the period on filing. A soft close rather than a hard one,
    // because a suppletie needs somebody to be able to post the correction —
    // and that somebody is the accountant, which is exactly what soft close
    // means here.
    const locked = await vat.lockPeriods(context.entityId, period.from, period.to)

    return {
      status: 201,
      body: {
        id,
        period: period.code,
        sequence: plan.sequence,
        isSuppletie: plan.isSuppletie,
        supersedes: plan.supersedesId,
        transport: plan.transport,
        differences: plan.differences.map((difference) => ({
          label: difference.label,
          filed: difference.filedMinorUnits.toString(),
          now: difference.nowMinorUnits.toString(),
        })),
        lockedPeriods: locked,
        owed: vatReturn.owedMinorUnits.toString(),
        deductible: vatReturn.deductibleMinorUnits.toString(),
        payable: vatReturn.payableMinorUnits.toString(),
      },
    }
  })
}

function serialiseIcpFinding(finding: IcpFinding) {
  return {
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    amount: finding.amountMinorUnits.toString(),
    lines: finding.lines.map((line) => ({
      entryId: line.entryId,
      entryNumber: line.entryNumber,
      journalCode: line.journalCode,
      bookingDate: line.bookingDate,
      lineNumber: line.lineNumber,
      accountNumber: line.accountNumber,
      accountName: line.accountName,
      description: line.description,
      taxCode: line.taxCode,
      amount: line.amountMinorUnits.toString(),
    })),
  }
}

export async function handleGetIcp(context: RequestContext, periodCode: string) {
  requirePermission(context, 'ledger:read')
  const period = parseVatPeriodCode(periodCode)

  return withVatRead(context.database, async (repository) => {
    const icp = await repository.buildIcp({
      entityId: context.entityId,
      from: period.from,
      to: period.to,
    })

    return {
      status: 200,
      body: {
        period: {
          code: period.code,
          label: period.label,
          kind: period.kind,
          from: period.from,
          to: period.to,
          deadline: vatDeadline(period),
        },
        entries: icp.entries.map((entry) => ({
          vatNumber: entry.vatNumber,
          countryCode: entry.countryCode,
          contactNumber: entry.contactNumber,
          contactName: entry.contactName,
          goods: entry.goodsMinorUnits.toString(),
          services: entry.servicesMinorUnits.toString(),
          total: entry.totalMinorUnits.toString(),
          proof: entry.proof,
          lineCount: entry.lines.length,
        })),
        goods: icp.goodsMinorUnits.toString(),
        services: icp.servicesMinorUnits.toString(),
        total: icp.totalMinorUnits.toString(),
        rubriek3b: icp.rubriek3bMinorUnits.toString(),
        difference: icp.differenceMinorUnits.toString(),
        findings: icp.findings.map(serialiseIcpFinding),
        blocked: icp.blocked,
      },
    }
  })
}

/**
 * Ask VIES and keep the answer.
 *
 * A write, even though it reads somebody else's register: the answer and the
 * moment it was given become this entity's evidence for a zero rate. The
 * validator never throws — an unreachable register is recorded as
 * `unavailable`, which is a different fact from "we did not ask" and only one
 * of the two is anybody's fault.
 */
export async function handleCheckVatNumbers(context: RequestContext, body: CheckVatNumbersBody) {
  requirePermission(context, 'ledger:configure')
  const idempotencyKey = requireIdempotencyKey(context)

  const { requesterVatNumber, replay } = await withVatRead(
    context.database,
    async (repository) => ({
      requesterVatNumber: await repository.ownVatNumber(context.entityId),
      replay: await repository.checksForKey(context.entityId, idempotencyKey),
    }),
  )

  // A retry replays what was already recorded. VIES is a shared public
  // register and a client retrying a timeout should not become two
  // consultations, nor two rows in the evidence history.
  if (replay.length > 0) {
    return {
      status: 200,
      body: {
        source: replay[0]?.source ?? 'replay',
        replayed: true,
        provenByConsultationNumber: replay.every((check) => check.requestIdentifier !== null),
        checks: replay.map((check) => ({
          vatNumber: check.vatNumber,
          countryCode: check.countryCode,
          outcome: check.outcome,
          name: check.name,
          address: check.address,
          requestDate: check.requestDate,
          requestIdentifier: check.requestIdentifier,
          checkedAt: check.checkedAt,
          source: check.source,
          error: check.error,
        })),
      },
    }
  }

  const validator = vatNumberValidator()
  const checks = await Promise.all(
    body.vatNumbers.map((vatNumber) => validator.check({ vatNumber, requesterVatNumber })),
  )

  await withVat(context.database, async (repository) => {
    for (const check of checks) {
      await repository.recordVatNumberCheck({
        entityId: context.entityId,
        check,
        requestedBy: context.actor.id,
        idempotencyKey,
      })
    }
  })

  return {
    status: 200,
    body: {
      source: validator.name,
      replayed: false,
      // Said out loud rather than buried: without the entity's own VAT number
      // VIES returns no consultation number, and the consultation number is
      // the only part of the answer that proves anything to anybody.
      provenByConsultationNumber: checks.every((check) => check.requestIdentifier !== null),
      checks: checks.map((check) => ({
        vatNumber: check.vatNumber,
        countryCode: check.countryCode,
        outcome: check.outcome,
        name: check.name,
        address: check.address,
        requestDate: check.requestDate,
        requestIdentifier: check.requestIdentifier,
        checkedAt: check.checkedAt,
        source: check.source,
        error: check.error,
      })),
    },
  }
}
