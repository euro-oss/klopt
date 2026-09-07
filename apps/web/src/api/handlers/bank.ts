import { createHash } from 'node:crypto'
import {
  DEFAULT_MATCH_OPTIONS,
  buildBankMatchEntry,
  normaliseIban,
  parseBankFile,
  planImport,
  postJournalEntry,
  ruleToLearn,
  suggestMatches,
  systemClock,
  type BankMatchAllocation,
} from '@klopt/core'
import { withBank, withBankMatch, withBankRead } from '@klopt/db'
import { hasPermission, mayPostToSoftClosedPeriod, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import type { ConfirmMatchBody, CreateBankAccountBody, ImportStatementBody } from '../schemas.js'

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

/**
 * What this bank line might be.
 *
 * Suggestions, never decisions. `@klopt/core` scores them and writes the
 * reason; this reads the candidates and the rules it needs and gets out of the
 * way. Nothing is posted until `confirmMatch`.
 */
export async function handleSuggestMatches(context: RequestContext, transactionId: string) {
  requirePermission(context, 'ledger:read')

  return withBankRead(context.database, async (repository) => {
    const transaction = await repository.findTransaction(context.entityId, transactionId)
    if (transaction === null) throw new ApiError('not_found', 'No such bank transaction.')

    const [candidates, rules] = await Promise.all([
      repository.matchCandidates(context.entityId),
      repository.listRules(context.entityId),
    ])

    /**
     * Bank charges need an account before they can be split off.
     *
     * `4900` is Algemene kosten in the shipped Dutch chart, and it is looked up
     * rather than assumed: a firm that brings its own chart is exactly the case
     * `reference-data/charts/` exists for, and a hard-coded account number
     * would produce a suggestion that cannot be posted. When it is absent,
     * charge splitting is simply not offered.
     *
     * This wants to be a per-entity setting. Until it is, this is the honest
     * version of the guess.
     */
    const chargesAccount = await repository.ledgerAccountIdFor(context.entityId, '4900')

    const suggestions = suggestMatches(transaction.entry, candidates, rules, {
      ...DEFAULT_MATCH_OPTIONS,
      chargesAccountNumber: chargesAccount === null ? null : '4900',
    })

    return {
      status: 200,
      body: {
        transaction: {
          id: transaction.id,
          amount: transaction.amount.toString(),
          currency: transaction.currency,
          bookingDate: transaction.bookingDate,
          counterpartyName: transaction.counterpartyName,
          counterpartyIban: transaction.counterpartyIban,
          description: transaction.description,
          status: transaction.status,
        },
        suggestions: suggestions.map((suggestion) => ({
          strategy: suggestion.strategy,
          confidence: suggestion.confidence,
          reason: suggestion.reason,
          accountNumber: suggestion.accountNumber,
          contactId: suggestion.contactId,
          chargesAmount: suggestion.chargesAmount.toString(),
          chargesAccountNumber: suggestion.chargesAccountNumber,
          ruleId: suggestion.ruleId,
          allocations: suggestion.allocations.map((allocation) => ({
            invoiceId: allocation.invoiceId,
            number: allocation.number,
            amount: (allocation.amount < 0n ? -allocation.amount : allocation.amount).toString(),
          })),
        })),
      },
    }
  })
}

/**
 * Book it.
 *
 * One transaction: the journal entry, the link, the allocations and the learned
 * rule. All of it or none — a match whose entry posted and whose allocation did
 * not would leave an invoice that the books say is paid and the dunning list
 * says is not.
 *
 * The entry goes through `postJournalEntry` like everything else, so period
 * control, the hash chain, the audit row and the outbox event all apply
 * (spec 9.1).
 */
export async function handleConfirmMatch(
  context: RequestContext,
  transactionId: string,
  body: ConfirmMatchBody,
) {
  requirePermission(context, 'ledger:post')
  const idempotencyKey = requireIdempotencyKey(context)

  return withBankMatch(context.database, async ({ bank: repository, ledger }) => {
    const transaction = await repository.findTransaction(context.entityId, transactionId)
    if (transaction === null) throw new ApiError('not_found', 'No such bank transaction.')
    if (transaction.status === 'matched') {
      throw new ApiError('conflict', 'This line is already booked. Reverse the entry to redo it.')
    }
    if (transaction.bankLedgerAccountNumber === null) {
      throw new ApiError(
        'validation_failed',
        'This bank account has no ledger account. Set one before booking.',
        [
          {
            code: 'unknown_account',
            path: 'bankAccountId',
            message: 'No ledger account is linked to this bank account.',
          },
        ],
      )
    }

    // Allocations are given as invoice ids; the entry needs the contact and the
    // invoice number on each line, which is what makes the debtors ledger read.
    const candidates = await repository.matchCandidates(context.entityId)
    const byId = new Map(candidates.map((candidate) => [candidate.invoiceId, candidate]))
    const incoming = transaction.amount > 0n

    const allocations: BankMatchAllocation[] = body.allocations.map((allocation) => {
      const candidate = byId.get(allocation.invoiceId)
      if (candidate === undefined) {
        throw new ApiError('validation_failed', 'That invoice is not open.', [
          {
            code: 'unknown_entry',
            path: 'allocations',
            message: `Invoice ${allocation.invoiceId} is not an open invoice of this administration.`,
          },
        ])
      }
      if (allocation.amount > candidate.outstanding) {
        throw new ApiError(
          'validation_failed',
          `More allocated to ${candidate.number} than is open.`,
          [
            {
              code: 'entry_unbalanced',
              path: 'allocations',
              message:
                `${candidate.number} has ${candidate.outstanding.toString()} open, ` +
                `${allocation.amount.toString()} was allocated.`,
            },
          ],
        )
      }

      return {
        invoiceId: candidate.invoiceId,
        invoiceNumber: candidate.number,
        amount: allocation.amount * (incoming ? 1n : -1n),
        contactNumber: candidate.contactId.slice(0, 8),
        contactName: candidate.contactName,
        contactId: candidate.contactId,
      }
    })

    const command = buildBankMatchEntry({
      entityId: context.entityId,
      journalCode: body.journalCode,
      bookingDate: transaction.bookingDate,
      valueDate: transaction.valueDate,
      bankAccountNumber: transaction.bankLedgerAccountNumber,
      amount: transaction.amount,
      currency: transaction.currency,
      counterpartyName: transaction.counterpartyName,
      description: transaction.description,
      receivableAccountNumber: body.receivableAccountNumber,
      allocations,
      remainderAccountNumber: body.accountNumber,
      chargesAmount: body.chargesAmount,
      chargesAccountNumber: body.chargesAccountNumber,
    })

    const posted = await postJournalEntry(
      command,
      context.actor,
      {
        dryRun: false,
        idempotencyKey: `${idempotencyKey}:bank-match`,
        requestId: context.requestId,
        ip: context.ip,
        mayPostToSoftClosedPeriod: mayPostToSoftClosedPeriod(context),
      },
      { repository: ledger, clock: systemClock },
    )

    await repository.recordMatch({
      entityId: context.entityId,
      transactionId,
      journalEntryId: posted.entry.id,
      allocations: allocations.map((allocation) => ({
        invoiceId: allocation.invoiceId,
        amount: allocation.amount,
      })),
    })

    if (body.ruleId !== null) await repository.bumpRule(context.entityId, body.ruleId)

    /**
     * Learn, but only from a line that had nothing to go on.
     *
     * A payment quoting its invoice number teaches nothing: the next one will
     * quote its own. What is worth remembering is "money from this account,
     * described like this, goes to that account" — a subscription, a bank
     * charge, a utility bill.
     */
    let learned = false
    if (body.learn && body.ruleId === null && allocations.length === 0) {
      const rule = ruleToLearn(transaction.entry, {
        accountNumber: body.accountNumber,
        contactId: null,
      })

      if (rule !== null) {
        const accountId =
          rule.accountNumber === null
            ? null
            : await repository.ledgerAccountIdFor(context.entityId, rule.accountNumber)

        if (accountId !== null || rule.contactId !== null) {
          await repository.learnRule({
            entityId: context.entityId,
            counterpartyIban: rule.counterpartyIban,
            counterpartyName: rule.counterpartyName,
            descriptionContains: rule.descriptionContains,
            accountId,
            contactId: rule.contactId,
          })
          learned = true
        }
      }
    }

    return {
      status: 200,
      body: {
        transactionId,
        journalEntryId: posted.entry.id,
        entryNumber: posted.entry.entryNumber,
        allocated: allocations.length,
        learned,
      },
    }
  })
}

export async function handleIgnoreTransaction(context: RequestContext, transactionId: string) {
  requirePermission(context, 'ledger:post')
  requireIdempotencyKey(context)

  const ignored = await withBank(context.database, (repository) =>
    repository.ignoreTransaction(context.entityId, transactionId),
  )

  if (!ignored) {
    throw new ApiError('conflict', 'That line is not waiting to be booked.')
  }

  return { status: 200, body: { transactionId, status: 'ignored' } }
}

export async function handleListMatchRules(context: RequestContext) {
  requirePermission(context, 'ledger:read')

  const rules = await withBankRead(context.database, (repository) =>
    repository.listRules(context.entityId),
  )

  return { status: 200, body: { rules } }
}

export async function handleSetMatchRuleActive(
  context: RequestContext,
  ruleId: string,
  body: { readonly isActive: boolean },
) {
  requirePermission(context, 'ledger:configure')

  const updated = await withBank(context.database, (repository) =>
    repository.setRuleActive(context.entityId, ruleId, body.isActive),
  )
  if (!updated) throw new ApiError('not_found', 'No such rule.')

  return { status: 200, body: { ruleId, isActive: body.isActive } }
}

export { normaliseIban }
