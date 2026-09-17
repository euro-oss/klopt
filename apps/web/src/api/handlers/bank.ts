import { createHash } from 'node:crypto'
import {
  DEFAULT_MATCH_OPTIONS,
  buildBankMatchEntry,
  detectBankFormat,
  guessCsvMapping,
  normaliseIban,
  parseBankCsv,
  parseBankFile,
  planImport,
  postJournalEntry,
  resourceOf,
  ruleToLearn,
  suggestMatches,
  systemClock,
  versionOf,
  type BankMatchAllocation,
  type CsvMapping,
  type StatementProblem,
} from '@klopt/core'
import { withBank, withBankMatch, withBankRead } from '@klopt/db'
import { hasPermission, mayPostToSoftClosedPeriod, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import { recordAudit } from '../audit.js'
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

  await recordAudit(context, {
    action: 'bank.createAccount',
    resourceType: 'bank_account',
    resourceId: id,
    after: { iban: body.iban, name: body.name, currency: body.currency },
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
 *
 * A CSV additionally needs a **mapping**, because there is no CSV standard and
 * every bank invents its own columns (spec 7.4). The order is: what the caller
 * passed, then what the account remembers, then a guess. A dry run with only a
 * guess imports nothing and returns the guess — which turns "fill in eleven
 * fields" into "check eight and correct three", and is the difference between a
 * configurable mapper and a form nobody completes.
 */
export async function handleImportStatement(context: RequestContext, body: ImportStatementBody) {
  requirePermission(context, 'ledger:import')
  if (!body.dryRun) requireIdempotencyKey(context)

  const sourceHash = createHash('sha256').update(body.content, 'utf8').digest('hex')

  return withBank(context.database, async (repository) => {
    const account = await repository.findAccount(context.entityId, body.bankAccountId)
    if (account === null) throw new ApiError('not_found', 'No such bank account.')

    const format = body.format ?? detectBankFormat(body.content)
    const stored = account.csvMapping as CsvMapping | null
    const mapping = format === 'csv' ? (body.mapping ?? stored) : null

    if (format === 'csv' && mapping === null) {
      const guess = guessCsvMapping(body.content)

      if (!body.dryRun) {
        throw new ApiError(
          'validation_failed',
          'This CSV has no mapping yet. Ask for a dry run first, check the guess, and send it back.',
          [
            {
              code: 'csv_mapping_required',
              path: 'mapping',
              message: 'No mapping is stored for this account and none was supplied.',
            },
          ],
        )
      }

      return {
        status: 200,
        body: {
          dryRun: true,
          needsMapping: true,
          format,
          guess: guess.mapping,
          header: guess.header,
          unmatched: guess.unmatched,
          period: null,
          statements: 0,
          entries: 0,
          newEntries: 0,
          duplicates: 0,
          imported: 0,
          problems: [] as readonly StatementProblem[],
          openingBalance: null,
          closingBalance: null,
        },
      }
    }

    const statements =
      mapping === null
        ? parseBankFile(body.content, format)
        : parseBankCsv(body.content, {
            accountIban: account.iban,
            mapping,
            statementId: null,
          })

    const plan = planImport(statements, {
      accountIban: account.iban,
      currency: account.currency,
      lastSequenceNumber: account.lastSequenceNumber,
    })

    const errors = plan.problems.filter((problem) => problem.severity === 'error')
    if (errors.length > 0) {
      throw new ApiError(
        'validation_failed',
        `This file cannot be imported: ${
          errors.length === 1 ? errors[0]!.message : `${String(errors.length)} problems.`
        }`,
        errors.map((problem) => ({ code: problem.code, path: null, message: problem.message })),
      )
    }

    /**
     * One body shape for a dry run and a real import, with `dryRun` saying
     * which it was. Differing in shape pushes the difference into every caller,
     * and the interesting fields — how many are new, how many were already
     * there — are the same question either way.
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
          needsMapping: false,
          format,
          guess: null,
          header: [] as readonly string[],
          unmatched: [] as readonly string[],
          period,
          statements: plan.statements.length,
          entries: plan.dedupeKeys.length,
          newEntries: plan.dedupeKeys.length - duplicates,
          duplicates,
          imported: 0,
          problems: plan.problems,
          openingBalance: statements[0]?.openingBalance?.toString() ?? null,
          closingBalance: statements.at(-1)?.closingBalance?.toString() ?? null,
        },
      }
    }

    const outcome = await repository.applyImport({
      entityId: context.entityId,
      bankAccountId: body.bankAccountId,
      plan,
      sourceHash,
    })

    // Remember how to read this bank's CSV, so the next import does not ask.
    if (mapping !== null && body.saveMapping) {
      await repository.saveCsvMapping(context.entityId, body.bankAccountId, mapping)
    }

    // The hash of the file as it arrived. It is what makes "this statement is
    // the one the bank sent" checkable, and it is what a duplicate import is
    // recognised by.
    await recordAudit(context, {
      action: 'bank.importStatement',
      resourceType: 'bank_account',
      resourceId: body.bankAccountId,
      after: {
        sourceHash,
        format,
        statements: outcome.statementIds.length,
        imported: outcome.imported,
        duplicates: outcome.duplicates,
      },
    })

    return {
      status: 201,
      body: {
        dryRun: false,
        needsMapping: false,
        format,
        guess: null,
        header: [] as readonly string[],
        unmatched: [] as readonly string[],
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
      transactions: rows.map((row) => ({
        ...row,
        amount: row.amount.toString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
      })),
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
     * The entity's own setting, not `4900`. That number is Algemene kosten in
     * the chart we ship and means nothing in a chart somebody brought with
     * them — which is exactly the case `reference-data/charts/` exists for, and
     * for whom charge splitting was silently never offered. Setup writes the
     * default when it installs our chart, so the guess happens once, where it
     * is defensible, rather than on every request.
     *
     * Still looked up: a setting pointing at an account that has since been
     * removed would produce a suggestion that cannot be posted, and not
     * offering the split is better than offering one that fails.
     */
    const configured = await repository.bankChargesAccountNumber(context.entityId)
    const chargesAccount =
      configured === null ? null : await repository.ledgerAccountIdFor(context.entityId, configured)

    const suggestions = suggestMatches(transaction.entry, candidates, rules, {
      ...DEFAULT_MATCH_OPTIONS,
      chargesAccountNumber: chargesAccount === null ? null : configured,
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

    /**
     * The invoices this payment closed (ADR 0051).
     *
     * `outstanding` is what was still open before this match, so an allocation
     * that covers it settles the invoice. Emitted per invoice rather than per
     * bank line, because "invoice 2026-0042 is paid" is the fact a consumer is
     * waiting for; that one transfer settled three of them is our arithmetic,
     * not theirs.
     *
     * In this transaction, like every other event: an outbox only gives its
     * guarantee when the event cannot commit without the change.
     */
    for (const allocation of allocations) {
      const candidate = byId.get(allocation.invoiceId)
      if (candidate === undefined) continue
      const applied = allocation.amount < 0n ? -allocation.amount : allocation.amount
      if (applied < candidate.outstanding) continue

      await ledger.enqueueEvent({
        entityId: context.entityId,
        type: 'sales.invoice.paid',
        version: versionOf('sales.invoice.paid'),
        payload: {
          resourceType: resourceOf('sales.invoice.paid'),
          resourceId: allocation.invoiceId,
        },
      })
    }

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

    // The entry has its own audit row from the posting. This one records the
    // decision: that this bank line was matched to these invoices, and by whom.
    await recordAudit(context, {
      action: 'bank.confirmMatch',
      resourceType: 'bank_transaction',
      resourceId: transactionId,
      after: {
        journalEntryId: posted.entry.id,
        entryNumber: posted.entry.entryNumber,
        allocations: allocations.length,
        learnedRule: learned,
      },
    })

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

  // Setting a line aside is a decision about money that arrived and was not
  // booked, which is exactly the sort of thing somebody asks about later.
  await recordAudit(context, {
    action: 'bank.ignoreTransaction',
    resourceType: 'bank_transaction',
    resourceId: transactionId,
    after: { status: 'ignored' },
  })

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
