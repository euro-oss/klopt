import { createHash } from 'node:crypto'
import { LedgerError, violation, type LedgerViolation } from '../errors.js'
import { uuidv7 } from '../ids.js'
import type { CurrencyCode } from '../money.js'
import { convertToFunctional } from './currency.js'
import { hashEntry } from './hash.js'
import { dimensionKey, type Clock, type LedgerRepository, type PostingContext } from './ports.js'
import type {
  Actor,
  JournalLineInput,
  PostJournalEntryCommand,
  PostedJournalEntry,
  PostedJournalLine,
  ResolvedDimension,
} from './types.js'
import { normaliseDecimal, validateCommandShape } from './validation.js'
import { resourceOf, versionOf } from '../events/catalogue.js'

/**
 * The one posting API (spec 6.5, 9.1).
 *
 * Every module — sales, purchase, banking, VAT, and whatever comes after —
 * creates journal entries through this function. Nothing writes to the journal
 * tables directly, because balance, period control, gapless numbering, the hash
 * chain, the audit log and the outbox all have to happen together or not at
 * all, and "remember to also..." is not an enforcement mechanism.
 *
 * The caller supplies a repository already bound to an open transaction. This
 * function does not open one: whether a transaction exists is a persistence
 * question, and the domain does not get to know the answer.
 */

export interface PostJournalEntryOptions {
  /**
   * Validate everything, return the entry that would be created, commit
   * nothing (spec 10.2). Importers, agents and the migration tooling all need
   * this, and so does anyone about to post a thousand entries.
   */
  readonly dryRun: boolean
  /**
   * Required on every write. A retried posting must never double-post, which is
   * non-negotiable in a ledger.
   */
  readonly idempotencyKey: string
  readonly requestId: string | null
  readonly ip: string | null
  /**
   * Whether this actor may post into a soft-closed period. Soft close means
   * "accountant only", which is a role question the domain does not answer for
   * itself — middleware resolves it and passes the answer in.
   */
  readonly mayPostToSoftClosedPeriod: boolean
}

export interface PostJournalEntryResult {
  readonly entry: PostedJournalEntry
  /** True when an idempotency key replayed an earlier post. Nothing was written. */
  readonly replayed: boolean
  readonly dryRun: boolean
}

export interface PostingDependencies {
  readonly repository: LedgerRepository
  readonly clock: Clock
  readonly newId?: () => string
}

const OPERATION_ID = 'ledger.postJournalEntry'

/** Stable digest of the command, so a reused key with a different body is caught. */
export function hashCommand(command: PostJournalEntryCommand): string {
  return createHash('sha256')
    .update(
      JSON.stringify(command, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
      'utf8',
    )
    .digest('hex')
}

function resolveLine(
  line: JournalLineInput,
  index: number,
  context: PostingContext,
  functionalCurrency: CurrencyCode,
  newId: () => string,
  violations: LedgerViolation[],
): PostedJournalLine | null {
  const path = `lines.${String(index)}`
  const account = context.accountsByNumber.get(line.accountNumber)

  if (account === undefined) {
    violations.push(
      violation('unknown_account.account', `${path}.accountNumber`, {
        accountNumber: line.accountNumber,
      }),
    )
    return null
  }

  if (account.isBlocked) {
    violations.push(
      violation('account_blocked', `${path}.accountNumber`, {
        name: account.name,
        accountNumber: account.number,
      }),
    )
  }

  const dimensions: ResolvedDimension[] = []
  for (const assignment of line.dimensions) {
    const type = context.dimensionTypesByCode.get(assignment.typeCode)
    if (type === undefined) {
      violations.push(
        violation('unknown_dimension_type', `${path}.dimensions`, {
          dimensionType: assignment.typeCode,
        }),
      )
      continue
    }

    const value = context.dimensionValuesByKey.get(
      dimensionKey(assignment.typeCode, assignment.valueCode),
    )
    if (value === undefined) {
      violations.push(
        violation('unknown_dimension_value', `${path}.dimensions`, {
          dimensionType: assignment.typeCode,
          dimensionValue: assignment.valueCode,
        }),
      )
      continue
    }

    if (value.isBlocked) {
      violations.push(
        violation('dimension_value_blocked', `${path}.dimensions`, {
          dimensionType: assignment.typeCode,
          dimensionValue: assignment.valueCode,
        }),
      )
    }

    dimensions.push({
      typeId: type.id,
      typeCode: type.code,
      valueId: value.id,
      valueCode: value.code,
    })
  }

  // "Any posting to fuel cost must carry a vehicle" (spec 6.3).
  const present = new Set(dimensions.map((dimension) => dimension.typeId))
  for (const requiredId of account.requiredDimensionTypeIds) {
    if (present.has(requiredId)) continue
    const type = [...context.dimensionTypesByCode.values()].find((it) => it.id === requiredId)
    violations.push(
      violation('missing_required_dimension', `${path}.dimensions`, {
        accountNumber: account.number,
        dimensionType: type?.code ?? requiredId,
      }),
    )
  }

  const currency = line.currency ?? functionalCurrency
  const rate =
    currency === functionalCurrency || line.exchangeRate === null
      ? null
      : normaliseDecimal(line.exchangeRate)

  return {
    id: newId(),
    lineNumber: index + 1,
    accountId: account.id,
    accountNumber: account.number,
    description: line.description,
    debit: line.debit,
    credit: line.credit,
    currency,
    // Placeholders. Functional amounts are allocated across the whole entry
    // once every line is resolved — see convertToFunctional.
    functionalDebit: 0n,
    functionalCredit: 0n,
    exchangeRate: rate,
    exchangeRateSource: rate === null ? null : line.exchangeRateSource,
    taxCode: line.taxCode,
    taxRole: line.taxRole,
    taxAmount: line.taxAmount,
    dimensions,
    subledgerKind: line.subledgerKind,
    subledgerId: line.subledgerId,
  }
}

export async function postJournalEntry(
  command: PostJournalEntryCommand,
  actor: Actor,
  options: PostJournalEntryOptions,
  deps: PostingDependencies,
): Promise<PostJournalEntryResult> {
  const { repository, clock } = deps
  const newId = deps.newId ?? uuidv7
  const requestHash = hashCommand(command)

  // Replay before anything else, so a retry never allocates a number or a chain
  // slot it will not use.
  if (!options.dryRun) {
    const existing = await repository.findIdempotencyRecord(
      command.entityId,
      options.idempotencyKey,
    )
    if (existing !== null) {
      if (existing.requestHash !== requestHash || existing.operationId !== OPERATION_ID) {
        throw new LedgerError([
          violation('idempotency_key_reused', 'idempotencyKey', { key: options.idempotencyKey }),
        ])
      }

      const entry = await repository.findEntryById(command.entityId, existing.resultId)
      if (entry === null) {
        throw new LedgerError([
          violation('unknown_entry', 'idempotencyKey', { key: options.idempotencyKey }),
        ])
      }
      return { entry, replayed: true, dryRun: false }
    }
  }

  const context = await repository.loadPostingContext({
    entityId: command.entityId,
    journalCode: command.journalCode,
    bookingDate: command.bookingDate,
    accountNumbers: command.lines.map((line) => line.accountNumber),
    dimensionTypeCodes: command.lines.flatMap((line) =>
      line.dimensions.map((dimension) => dimension.typeCode),
    ),
    dimensionPairs: command.lines.flatMap((line) => line.dimensions),
  })

  if (context === null) {
    throw new LedgerError([violation('unknown_entity', 'entityId', { entityId: command.entityId })])
  }

  const functionalCurrency = context.entity.functionalCurrency
  const violations: LedgerViolation[] = [...validateCommandShape(command, functionalCurrency)]

  if (context.journal === null) {
    violations.push(
      violation('unknown_journal', 'journalCode', { journalCode: command.journalCode }),
    )
  }

  if (context.period === null) {
    violations.push(
      violation('no_period_for_date', 'bookingDate', { bookingDate: command.bookingDate }),
    )
  } else if (context.period.status === 'hard_closed') {
    violations.push(
      violation('period_hard_closed', 'bookingDate', {
        period: String(context.period.sequence),
        fiscalYear: context.period.fiscalYearCode,
      }),
    )
  } else if (context.period.status === 'soft_closed' && !options.mayPostToSoftClosedPeriod) {
    violations.push(
      violation('period_soft_closed', 'bookingDate', {
        period: String(context.period.sequence),
        fiscalYear: context.period.fiscalYearCode,
      }),
    )
  }

  if (command.reversesEntryId !== null) {
    const target = await repository.findEntryById(command.entityId, command.reversesEntryId)
    if (target === null) {
      violations.push(
        violation('reversal_target_not_found', 'reversesEntryId', {
          reversesEntryId: command.reversesEntryId,
        }),
      )
    } else {
      const alreadyReversed = await repository.findReversalOf(
        command.entityId,
        command.reversesEntryId,
      )
      if (alreadyReversed !== null) {
        violations.push(
          violation('reversal_target_already_reversed', 'reversesEntryId', {
            reversesEntryId: command.reversesEntryId,
            reversedBy: alreadyReversed,
          }),
        )
      }
    }
  }

  const resolved: PostedJournalLine[] = []
  command.lines.forEach((line, index) => {
    const item = resolveLine(line, index, context, functionalCurrency, newId, violations)
    if (item !== null) resolved.push(item)
  })

  if (violations.length > 0) throw new LedgerError(violations)

  const conversion = convertToFunctional(resolved)
  const lines: PostedJournalLine[] = resolved.map((line, index) => ({
    ...line,
    functionalDebit: conversion.amounts[index]!.functionalDebit,
    functionalCredit: conversion.amounts[index]!.functionalCredit,
  }))

  if (conversion.residual !== 0n) {
    // The authoritative balance check. Rounding on conversion cannot land here
    // — that is allocated away on the entry total — so a residual is a real
    // amount: a realised exchange result, or a genuinely unbalanced entry.
    // Either way it needs a destination account chosen by a human, because
    // nothing is silently absorbed (spec 6.1).
    throw new LedgerError([
      violation('entry_unbalanced_functional', 'lines', {
        difference: conversion.residual.toString(),
        functionalCurrency,
      }),
    ])
  }

  // Non-null past this point: a null journal or period produced a violation.
  const journal = context.journal!
  const period = context.period!

  const chain = options.dryRun
    ? { sequence: 0n, previousHash: null }
    : await repository.allocateChainPosition(command.entityId)

  const entryNumber = options.dryRun
    ? 0
    : await repository.allocateEntryNumber({
        entityId: command.entityId,
        documentType: `journal:${journal.code}`,
        fiscalYearCode: period.fiscalYearCode,
      })

  const draft = {
    id: newId(),
    entityId: command.entityId,
    journalId: journal.id,
    journalCode: journal.code,
    fiscalYearId: period.fiscalYearId,
    fiscalYearCode: period.fiscalYearCode,
    periodId: period.id,
    periodSequence: period.sequence,
    entryNumber,
    chainSequence: chain.sequence,
    bookingDate: command.bookingDate,
    documentDate: command.documentDate,
    description: command.description,
    sourceDocumentRef: command.sourceDocumentRef,
    reversesEntryId: command.reversesEntryId,
    functionalCurrency,
    createdAt: clock.now().toISOString(),
    actor,
    previousHash: chain.previousHash,
    lines,
  }

  const entry: PostedJournalEntry = { ...draft, hash: hashEntry(draft) }

  if (options.dryRun) {
    return { entry, replayed: false, dryRun: true }
  }

  await repository.insertEntry(entry)
  await repository.applyPeriodBalances(entry)
  await repository.recordIdempotency(command.entityId, {
    key: options.idempotencyKey,
    operationId: OPERATION_ID,
    requestHash,
    resultId: entry.id,
  })
  await repository.appendAudit({
    entityId: command.entityId,
    actor,
    action: OPERATION_ID,
    resourceType: 'journal_entry',
    resourceId: entry.id,
    // The journal is append-only, so there is never a prior state.
    before: null,
    after: { hash: entry.hash, chainSequence: entry.chainSequence.toString() },
    requestId: options.requestId,
    ip: options.ip,
  })
  // Thin: what happened and to what, never the resource itself. The reasons
  // are on `EVENT_TYPES`, and the third one — not posting somebody's data to
  // four subscribers — is the one that settles it.
  await repository.enqueueEvent({
    entityId: command.entityId,
    type: 'ledger.entry.posted',
    version: versionOf('ledger.entry.posted'),
    payload: { resourceType: resourceOf('ledger.entry.posted'), resourceId: entry.id },
  })

  return { entry, replayed: false, dryRun: false }
}

/**
 * Build the reversing entry for a posted one (spec 6.2). Debits become credits.
 * The reversal is a normal entry: it gets its own number, its own chain slot and
 * its own audit trail, and it can itself be reversed.
 */
export function buildReversal(
  entry: PostedJournalEntry,
  options: { readonly bookingDate: string; readonly description: string | null },
): PostJournalEntryCommand {
  return {
    entityId: entry.entityId,
    journalCode: entry.journalCode,
    bookingDate: options.bookingDate,
    documentDate: entry.documentDate,
    description:
      options.description ??
      `Reversal of ${entry.journalCode} ${String(entry.entryNumber)}: ${entry.description}`,
    sourceDocumentRef: entry.sourceDocumentRef,
    reversesEntryId: entry.id,
    lines: entry.lines.map((line) => ({
      accountNumber: line.accountNumber,
      description: line.description,
      debit: line.credit,
      credit: line.debit,
      currency: line.currency,
      exchangeRate: line.exchangeRate,
      exchangeRateSource: line.exchangeRateSource,
      taxCode: line.taxCode,
      taxRole: line.taxRole,
      taxAmount: line.taxAmount === null ? null : -line.taxAmount,
      dimensions: line.dimensions.map((dimension) => ({
        typeCode: dimension.typeCode,
        valueCode: dimension.valueCode,
      })),
      subledgerKind: line.subledgerKind,
      subledgerId: line.subledgerId,
    })),
  }
}
