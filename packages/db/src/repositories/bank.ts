import { consentStateFor, uuidv7, type ImportPlan, type StatementProblem } from '@klopt/core'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { accounts, bankAccounts, bankStatements, bankTransactions } from '../schema/index.js'

/**
 * Bank persistence.
 *
 * The parsing, the dedupe keys and every warning about a truncated file or a
 * missing statement are decided by `@klopt/core`. What is here is the write,
 * and one thing that cannot be decided without a database: which of the keys in
 * the file are already in it.
 *
 * Deduplication is **a unique index and an `onConflictDoNothing`**, not a
 * lookup followed by an insert. Two imports racing would both pass the lookup;
 * only one can win the index. The count of what was actually inserted comes
 * back from the database rather than being assumed.
 */

export interface BankAccountRow {
  readonly id: string
  readonly iban: string
  readonly currency: string
  readonly name: string
  readonly ledgerAccountNumber: string | null
  readonly lastSequenceNumber: number | null
  readonly feedProvider: string
  readonly consentExpiresAt: string | null
  readonly consentState: string
}

export interface ImportOutcome {
  readonly statementIds: readonly string[]
  readonly imported: number
  readonly duplicates: number
  readonly problems: readonly StatementProblem[]
  readonly openingBalance: string
  readonly closingBalance: string
}

export class BankRepository {
  constructor(private readonly tx: Transaction) {}

  async listAccounts(entityId: string): Promise<readonly BankAccountRow[]> {
    const rows = await this.tx
      .select({
        id: bankAccounts.id,
        iban: bankAccounts.iban,
        currency: bankAccounts.currency,
        name: bankAccounts.name,
        ledgerAccountNumber: accounts.number,
        lastSequenceNumber: bankAccounts.lastSequenceNumber,
        feedProvider: bankAccounts.feedProvider,
        consentExpiresAt: bankAccounts.consentExpiresAt,
      })
      .from(bankAccounts)
      .leftJoin(accounts, eq(accounts.id, bankAccounts.ledgerAccountId))
      .where(eq(bankAccounts.entityId, entityId))
      .orderBy(asc(bankAccounts.iban))

    return rows.map((row) => ({
      ...row,
      consentExpiresAt: row.consentExpiresAt?.toISOString() ?? null,
      // Derived, never stored: a stored state is wrong the moment the clock
      // moves past it, which for a consent is exactly what happens.
      consentState: consentStateFor(row.consentExpiresAt?.toISOString() ?? null),
    }))
  }

  async findAccount(entityId: string, bankAccountId: string) {
    const [row] = await this.tx
      .select({
        id: bankAccounts.id,
        iban: bankAccounts.iban,
        currency: bankAccounts.currency,
        name: bankAccounts.name,
        ledgerAccountId: bankAccounts.ledgerAccountId,
        lastSequenceNumber: bankAccounts.lastSequenceNumber,
      })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.entityId, entityId), eq(bankAccounts.id, bankAccountId)))
      .limit(1)

    return row ?? null
  }

  async createAccount(request: {
    readonly entityId: string
    readonly iban: string
    readonly currency: string
    readonly name: string
    readonly ledgerAccountId: string | null
  }): Promise<string> {
    const id = uuidv7()
    await this.tx.insert(bankAccounts).values({ id, ...request })
    return id
  }

  async ledgerAccountIdFor(entityId: string, number: string): Promise<string | null> {
    const [row] = await this.tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.entityId, entityId), eq(accounts.number, number)))
      .limit(1)
    return row?.id ?? null
  }

  /**
   * Write a planned import.
   *
   * Statements first, then their entries. A statement with no new entries is
   * still recorded: it is evidence the file was seen, and its sequence number
   * is what the next gap check compares against.
   */
  async applyImport(request: {
    readonly entityId: string
    readonly bankAccountId: string
    readonly plan: ImportPlan
    readonly sourceHash: string
  }): Promise<ImportOutcome> {
    const statementIds: string[] = []
    let imported = 0
    let attempted = 0
    let highestSequence: number | null = null
    let openingBalance = 0n
    let closingBalance = 0n
    let first = true

    for (const planned of request.plan.statements) {
      // An error is a refusal, not a warning: a truncated file must not become
      // a wrong balance somebody trusts.
      if (planned.problems.some((problem) => problem.severity === 'error')) continue

      const statementId = uuidv7()
      await this.tx.insert(bankStatements).values({
        id: statementId,
        entityId: request.entityId,
        bankAccountId: request.bankAccountId,
        format: planned.statement.format,
        externalId: planned.statement.statementId,
        sequenceNumber: planned.statement.sequenceNumber,
        openingBalanceMinorUnits: planned.statement.openingBalance,
        closingBalanceMinorUnits: planned.statement.closingBalance,
        openingDate: planned.statement.openingDate,
        closingDate: planned.statement.closingDate,
        sourceHash: request.sourceHash,
      })
      statementIds.push(statementId)

      if (first) {
        openingBalance = planned.statement.openingBalance
        first = false
      }
      closingBalance = planned.statement.closingBalance

      if (
        planned.statement.sequenceNumber !== null &&
        (highestSequence === null || planned.statement.sequenceNumber > highestSequence)
      ) {
        highestSequence = planned.statement.sequenceNumber
      }

      for (const item of planned.entries) {
        attempted += 1
        const inserted = await this.tx
          .insert(bankTransactions)
          .values({
            id: uuidv7(),
            entityId: request.entityId,
            bankAccountId: request.bankAccountId,
            statementId,
            dedupeKey: item.dedupeKey,
            amountMinorUnits: item.entry.amount,
            currency: item.entry.currency,
            bookingDate: item.entry.bookingDate,
            valueDate: item.entry.valueDate,
            bankReference: item.entry.bankReference,
            endToEndId: item.entry.endToEndId,
            counterpartyName: item.entry.counterpartyName,
            counterpartyIban: item.entry.counterpartyIban,
            description: item.entry.description,
            remittanceReference: item.entry.remittanceReference,
            transactionCode: item.entry.transactionCode,
            raw: item.entry.raw,
          })
          // The index decides, not a prior lookup. Two imports racing both pass
          // a lookup; only one wins the index.
          .onConflictDoNothing({
            target: [bankTransactions.bankAccountId, bankTransactions.dedupeKey],
          })
          .returning({ id: bankTransactions.id })

        if (inserted.length > 0) imported += 1
      }
    }

    if (highestSequence !== null) {
      await this.tx
        .update(bankAccounts)
        .set({ lastSequenceNumber: highestSequence, updatedAt: new Date().toISOString() })
        .where(eq(bankAccounts.id, request.bankAccountId))
    }

    return {
      statementIds,
      imported,
      duplicates: attempted - imported,
      problems: request.plan.problems,
      openingBalance: openingBalance.toString(),
      closingBalance: closingBalance.toString(),
    }
  }

  async listTransactions(request: {
    readonly entityId: string
    readonly bankAccountId: string | null
    readonly status: 'unmatched' | 'matched' | 'ignored' | null
    readonly limit: number
  }) {
    const conditions = [eq(bankTransactions.entityId, request.entityId)]
    if (request.bankAccountId !== null) {
      conditions.push(eq(bankTransactions.bankAccountId, request.bankAccountId))
    }
    if (request.status !== null) conditions.push(eq(bankTransactions.status, request.status))

    return this.tx
      .select({
        id: bankTransactions.id,
        bankAccountId: bankTransactions.bankAccountId,
        amount: bankTransactions.amountMinorUnits,
        currency: bankTransactions.currency,
        bookingDate: bankTransactions.bookingDate,
        valueDate: bankTransactions.valueDate,
        counterpartyName: bankTransactions.counterpartyName,
        counterpartyIban: bankTransactions.counterpartyIban,
        description: bankTransactions.description,
        endToEndId: bankTransactions.endToEndId,
        remittanceReference: bankTransactions.remittanceReference,
        status: bankTransactions.status,
        journalEntryId: bankTransactions.journalEntryId,
      })
      .from(bankTransactions)
      .where(and(...conditions))
      .orderBy(desc(bankTransactions.bookingDate), asc(bankTransactions.id))
      .limit(request.limit)
  }

  /** The balance the statements say, and the balance the ledger says. */
  async reconciliation(entityId: string, bankAccountId: string) {
    const [statement] = await this.tx
      .select({
        closingBalance: bankStatements.closingBalanceMinorUnits,
        closingDate: bankStatements.closingDate,
      })
      .from(bankStatements)
      .where(
        and(eq(bankStatements.entityId, entityId), eq(bankStatements.bankAccountId, bankAccountId)),
      )
      .orderBy(desc(bankStatements.closingDate), desc(bankStatements.importedAt))
      .limit(1)

    const [unmatched] = await this.tx
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${bankTransactions.amountMinorUnits}), 0)::text`,
      })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.entityId, entityId),
          eq(bankTransactions.bankAccountId, bankAccountId),
          eq(bankTransactions.status, 'unmatched'),
        ),
      )

    return {
      statementBalance: statement?.closingBalance?.toString() ?? null,
      statementDate: statement?.closingDate ?? null,
      unmatchedCount: unmatched?.count ?? 0,
      unmatchedTotal: unmatched?.total ?? '0',
    }
  }

  /** Which of these keys the account already has. For a dry run. */
  async existingKeys(bankAccountId: string, keys: readonly string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set()

    const rows = await this.tx
      .select({ dedupeKey: bankTransactions.dedupeKey })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.bankAccountId, bankAccountId),
          inArray(bankTransactions.dedupeKey, [...keys]),
        ),
      )

    return new Set(rows.map((row) => row.dedupeKey))
  }
}
