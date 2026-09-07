import { createHash } from 'node:crypto'
import { normaliseIban, parseBankFile, planImport } from '@klopt/core'
import { withBank, withBankRead } from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import type { CreateBankAccountBody, ImportStatementBody } from '../schemas.js'

/**
 * Banking (spec 7.4).
 *
 * Every decision here was made in `@klopt/core`: the parsing, the dedupe keys,
 * the warning about a missing statement and the refusal of a file that does not
 * add up. What is left is the permission check, the transaction, and turning a
 * refusal into a status code.
 *
 * A file with an **error** is refused outright rather than partially imported.
 * A truncated statement becomes a wrong balance, and a wrong balance in a bank
 * reconciliation is trusted by everyone who looks at it.
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

export async function handleListBankAccounts(context: RequestContext) {
  requirePermission(context, 'ledger:read')

  const accounts = await withBankRead(context.database, async (repository) => {
    const rows = await repository.listAccounts(context.entityId)
    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        reconciliation: await repository.reconciliation(context.entityId, row.id),
      })),
    )
  })

  return { status: 200, body: { accounts } }
}

export async function handleCreateBankAccount(
  context: RequestContext,
  body: CreateBankAccountBody,
) {
  requirePermission(context, 'ledger:configure')

  const id = await withBank(context.database, async (repository) => {
    const ledgerAccountId =
      body.ledgerAccountNumber === null
        ? null
        : await repository.ledgerAccountIdFor(context.entityId, body.ledgerAccountNumber)

    if (body.ledgerAccountNumber !== null && ledgerAccountId === null) {
      throw new ApiError('validation_failed', `No ledger account ${body.ledgerAccountNumber}.`, [
        {
          code: 'unknown_account',
          path: 'ledgerAccountNumber',
          message: 'That account is not in the chart.',
        },
      ])
    }

    return repository.createAccount({
      entityId: context.entityId,
      iban: body.iban,
      currency: body.currency,
      name: body.name,
      ledgerAccountId,
    })
  })

  return { status: 201, body: { id, iban: body.iban } }
}

/**
 * Import a statement file.
 *
 * The dry run is not a courtesy. A bank file is opaque, an accountant's
 * download is often the wrong month, and the difference between "this adds 42
 * transactions" and "this adds 3 and 39 are already there" is worth seeing
 * before it happens.
 */
export async function handleImportStatement(context: RequestContext, body: ImportStatementBody) {
  requirePermission(context, 'ledger:import')
  if (!body.dryRun) requireIdempotencyKey(context)

  const sourceHash = createHash('sha256').update(body.content, 'utf8').digest('hex')

  return withBank(context.database, async (repository) => {
    const account = await repository.findAccount(context.entityId, body.bankAccountId)
    if (account === null) throw new ApiError('not_found', 'No such bank account.')

    const statements = parseBankFile(body.content, body.format ?? undefined)
    const plan = planImport(statements, {
      accountIban: account.iban,
      currency: account.currency,
      lastSequenceNumber: account.lastSequenceNumber,
    })

    const errors = plan.problems.filter((problem) => problem.severity === 'error')
    if (errors.length > 0) {
      throw new ApiError(
        'validation_failed',
        `This file cannot be imported: ${errors.length === 1 ? errors[0]!.message : `${String(errors.length)} problems.`}`,
        errors.map((problem) => ({
          code: problem.code,
          path: null,
          message: problem.message,
        })),
      )
    }

    /**
     * One body shape for both, with `dryRun` saying which it was.
     *
     * A dry run and a real import differing in *shape* pushes the difference
     * into every caller, and the interesting fields — how many are new, how
     * many were already there — are the same question either way.
     */
    const existing = await repository.existingKeys(body.bankAccountId, plan.dedupeKeys)
    const duplicates = plan.dedupeKeys.filter((key) => existing.has(key)).length
    const period =
      statements.length === 0
        ? null
        : { from: statements[0]!.openingDate, to: statements.at(-1)!.closingDate }

    if (body.dryRun) {
      return {
        status: 200,
        body: {
          dryRun: true,
          format: statements[0]?.format ?? null,
          period,
          statements: plan.statements.length,
          entries: plan.dedupeKeys.length,
          newEntries: plan.dedupeKeys.length - duplicates,
          duplicates,
          imported: 0,
          problems: plan.problems,
          openingBalance: statements[0]?.openingBalance.toString() ?? '0',
          closingBalance: statements.at(-1)?.closingBalance.toString() ?? '0',
        },
      }
    }

    const outcome = await repository.applyImport({
      entityId: context.entityId,
      bankAccountId: body.bankAccountId,
      plan,
      sourceHash,
    })

    return {
      status: 201,
      body: {
        dryRun: false,
        format: statements[0]?.format ?? null,
        period,
        statements: outcome.statementIds.length,
        entries: plan.dedupeKeys.length,
        newEntries: outcome.imported,
        duplicates: outcome.duplicates,
        imported: outcome.imported,
        problems: outcome.problems,
        openingBalance: outcome.openingBalance,
        closingBalance: outcome.closingBalance,
      },
    }
  })
}

export async function handleListBankTransactions(
  context: RequestContext,
  query: {
    readonly bankAccountId: string | null
    readonly status: 'unmatched' | 'matched' | 'ignored' | null
    readonly limit: number
  },
) {
  requirePermission(context, 'ledger:read')

  const rows = await withBankRead(context.database, (repository) =>
    repository.listTransactions({ entityId: context.entityId, ...query }),
  )

  return {
    status: 200,
    body: {
      transactions: rows.map((row) => ({ ...row, amount: row.amount.toString() })),
    },
  }
}

export { normaliseIban }
