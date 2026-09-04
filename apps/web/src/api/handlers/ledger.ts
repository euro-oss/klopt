import {
  buildReversal,
  buildTrialBalance,
  postJournalEntry,
  systemClock,
  verifyHashChain,
  type PostJournalEntryCommand,
  type PostedJournalEntry,
  type TrialBalanceReport,
} from '@klopt/core'
import { withLedger, withReporting } from '@klopt/db'
import { hasPermission, mayPostToSoftClosedPeriod, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import type { PostJournalEntryBody, ReverseJournalEntryBody } from '../schemas.js'

/**
 * Ledger handlers.
 *
 * Plain functions over a resolved context, deliberately: the route files are
 * thin adapters that parse a Request and serialise a Response, and everything
 * worth testing is testable without booting a server. Server functions for the
 * UI call these same handlers, so there is one implementation and no privileged
 * path (principle 3).
 *
 * No business rules live here. This layer resolves permissions, calls
 * @klopt/core, and shapes the wire representation.
 */

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

function requireIdempotencyKey(context: RequestContext): string {
  if (context.idempotencyKey === null || context.idempotencyKey === '') {
    throw new ApiError(
      'idempotency_key_required',
      'Every write needs an Idempotency-Key header. A retried posting must never double-post.',
    )
  }
  return context.idempotencyKey
}

/** Money leaves as a decimal-free minor-unit string; never a JSON number. */
function serialiseEntry(entry: PostedJournalEntry) {
  return {
    id: entry.id,
    entityId: entry.entityId,
    journalCode: entry.journalCode,
    entryNumber: entry.entryNumber,
    chainSequence: entry.chainSequence.toString(),
    fiscalYear: entry.fiscalYearCode,
    period: entry.periodSequence,
    bookingDate: entry.bookingDate,
    documentDate: entry.documentDate,
    description: entry.description,
    sourceDocumentRef: entry.sourceDocumentRef,
    reversesEntryId: entry.reversesEntryId,
    functionalCurrency: entry.functionalCurrency,
    createdAt: entry.createdAt,
    actor: entry.actor,
    previousHash: entry.previousHash,
    hash: entry.hash,
    lines: entry.lines.map((line) => ({
      lineNumber: line.lineNumber,
      accountNumber: line.accountNumber,
      description: line.description,
      debit: line.debit.toString(),
      credit: line.credit.toString(),
      currency: line.currency,
      functionalDebit: line.functionalDebit.toString(),
      functionalCredit: line.functionalCredit.toString(),
      exchangeRate: line.exchangeRate,
      exchangeRateSource: line.exchangeRateSource,
      taxCode: line.taxCode,
      taxAmount: line.taxAmount === null ? null : line.taxAmount.toString(),
      dimensions: line.dimensions.map((dimension) => ({
        type: dimension.typeCode,
        value: dimension.valueCode,
      })),
      subledgerKind: line.subledgerKind,
      subledgerId: line.subledgerId,
    })),
  }
}

function toCommand(context: RequestContext, body: PostJournalEntryBody): PostJournalEntryCommand {
  return {
    entityId: context.entityId,
    journalCode: body.journalCode,
    bookingDate: body.bookingDate,
    documentDate: body.documentDate,
    description: body.description,
    sourceDocumentRef: body.sourceDocumentRef,
    reversesEntryId: body.reversesEntryId,
    lines: body.lines,
  }
}

export async function handlePostJournalEntry(context: RequestContext, body: PostJournalEntryBody) {
  requirePermission(context, 'ledger:post')
  const idempotencyKey = requireIdempotencyKey(context)

  const result = await withLedger(context.database, (repository) =>
    postJournalEntry(
      toCommand(context, body),
      context.actor,
      {
        dryRun: body.dryRun,
        idempotencyKey,
        requestId: context.requestId,
        ip: context.ip,
        mayPostToSoftClosedPeriod: mayPostToSoftClosedPeriod(context),
      },
      { repository, clock: systemClock },
    ),
  )

  return {
    status: result.replayed || result.dryRun ? 200 : 201,
    body: {
      entry: serialiseEntry(result.entry),
      replayed: result.replayed,
      dryRun: result.dryRun,
    },
  }
}

export async function handleReverseJournalEntry(
  context: RequestContext,
  entryId: string,
  body: ReverseJournalEntryBody,
) {
  requirePermission(context, 'ledger:post')
  const idempotencyKey = requireIdempotencyKey(context)

  const result = await withLedger(context.database, async (repository) => {
    const original = await repository.findEntryById(context.entityId, entryId)
    if (original === null) {
      throw new ApiError('not_found', `No entry ${entryId}.`)
    }

    return postJournalEntry(
      buildReversal(original, {
        bookingDate: body.bookingDate,
        description: body.description,
      }),
      context.actor,
      {
        dryRun: body.dryRun,
        idempotencyKey,
        requestId: context.requestId,
        ip: context.ip,
        mayPostToSoftClosedPeriod: mayPostToSoftClosedPeriod(context),
      },
      { repository, clock: systemClock },
    )
  })

  return {
    status: result.replayed || result.dryRun ? 200 : 201,
    body: {
      entry: serialiseEntry(result.entry),
      replayed: result.replayed,
      dryRun: result.dryRun,
    },
  }
}

export async function handleGetJournalEntry(context: RequestContext, entryId: string) {
  requirePermission(context, 'ledger:read')

  const entry = await withLedger(context.database, (repository) =>
    repository.findEntryById(context.entityId, entryId),
  )
  if (entry === null) throw new ApiError('not_found', `No entry ${entryId}.`)

  return { status: 200, body: { entry: serialiseEntry(entry) } }
}

export async function handleListJournalEntries(
  context: RequestContext,
  query: { cursor: string | null; limit: number },
) {
  requirePermission(context, 'ledger:read')

  const rows = await withReporting(context.database, (repository) =>
    repository.listEntries({
      entityId: context.entityId,
      afterSequence: query.cursor === null ? null : BigInt(query.cursor),
      limit: query.limit,
    }),
  )

  return {
    status: 200,
    body: {
      entries: rows.map((row) => ({
        id: row.id,
        chainSequence: row.chainSequence.toString(),
        entryNumber: row.entryNumber,
        bookingDate: row.bookingDate,
        documentDate: row.documentDate,
        description: row.description,
        hash: row.hash,
      })),
      // Cursor pagination everywhere (spec 10.2). Null means the end.
      nextCursor:
        rows.length === query.limit ? (rows.at(-1)?.chainSequence.toString() ?? null) : null,
    },
  }
}

function serialiseTrialBalance(report: TrialBalanceReport) {
  return {
    entityId: report.entityId,
    currency: report.currency,
    fiscalYear: report.fiscalYearCode,
    fromPeriod: report.fromPeriod,
    toPeriod: report.toPeriod,
    totalDebit: report.totalDebit.toString(),
    totalCredit: report.totalCredit.toString(),
    difference: report.difference.toString(),
    lines: report.lines.map((line) => ({
      accountNumber: line.accountNumber,
      accountName: line.accountName,
      accountType: line.accountType,
      rgsCode: line.rgsCode,
      openingBalance: line.openingBalance.toString(),
      debit: line.debit.toString(),
      credit: line.credit.toString(),
      closingBalance: line.closingBalance.toString(),
    })),
  }
}

export async function handleGetTrialBalance(
  context: RequestContext,
  query: {
    fiscalYear: string
    fromPeriod: number
    toPeriod: number
    currency: string
    includeZeroRows: boolean
  },
) {
  requirePermission(context, 'ledger:read')

  const rows = await withReporting(context.database, (repository) =>
    repository.trialBalanceRows({
      entityId: context.entityId,
      fiscalYearCode: query.fiscalYear,
      fromPeriod: query.fromPeriod,
      toPeriod: query.toPeriod,
      currency: query.currency,
    }),
  )

  const report = buildTrialBalance(
    {
      entityId: context.entityId,
      currency: query.currency,
      fiscalYearCode: query.fiscalYear,
      fromPeriod: query.fromPeriod,
      toPeriod: query.toPeriod,
      includeZeroRows: query.includeZeroRows,
    },
    rows,
  )

  return { status: 200, body: serialiseTrialBalance(report) }
}

export async function handleVerifyChain(context: RequestContext) {
  requirePermission(context, 'ledger:read')

  const entries = await withLedger(context.database, (repository) =>
    repository.loadChain(context.entityId),
  )
  const result = verifyHashChain(entries)

  return {
    status: 200,
    body: {
      verified: result.verified,
      entryCount: result.entryCount,
      // Publish the head hash: this is the value an inspector records now and
      // checks against later (spec 6.2).
      headHash: result.headHash,
      failures: result.failures.map((failure) => ({
        entryId: failure.entryId,
        chainSequence: failure.chainSequence.toString(),
        reason: failure.reason,
        expected: failure.expected,
        actual: failure.actual,
      })),
    },
  }
}

export async function handleListAccounts(context: RequestContext) {
  requirePermission(context, 'ledger:read')

  const rows = await withReporting(context.database, (repository) =>
    repository.listAccounts(context.entityId),
  )

  return {
    status: 200,
    body: {
      accounts: rows,
      // Unmapped accounts are a health metric, not a settings screen nobody
      // visits (spec 7.1).
      rgsCoverage: {
        total: rows.length,
        mapped: rows.filter((account) => account.rgsCode !== null).length,
      },
    },
  }
}
