import {
  consentStateFor,
  normaliseIbanForMatch,
  uuidv7,
  type BankEntry,
  type ImportPlan,
  type MatchCandidate,
  type MatchRule,
  type StatementProblem,
} from '@klopt/core'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import {
  accounts,
  bankAccounts,
  bankMatchRules,
  bankStatements,
  bankTransactionAllocations,
  bankTransactions,
  contacts,
  salesInvoices,
} from '../schema/index.js'

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

  /** One transaction, as the matcher needs it. */
  async findTransaction(entityId: string, transactionId: string) {
    const [row] = await this.tx
      .select({
        id: bankTransactions.id,
        bankAccountId: bankTransactions.bankAccountId,
        amount: bankTransactions.amountMinorUnits,
        currency: bankTransactions.currency,
        bookingDate: bankTransactions.bookingDate,
        valueDate: bankTransactions.valueDate,
        bankReference: bankTransactions.bankReference,
        endToEndId: bankTransactions.endToEndId,
        counterpartyName: bankTransactions.counterpartyName,
        counterpartyIban: bankTransactions.counterpartyIban,
        description: bankTransactions.description,
        remittanceReference: bankTransactions.remittanceReference,
        transactionCode: bankTransactions.transactionCode,
        raw: bankTransactions.raw,
        status: bankTransactions.status,
        journalEntryId: bankTransactions.journalEntryId,
        bankLedgerAccountNumber: accounts.number,
      })
      .from(bankTransactions)
      .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.bankAccountId))
      .leftJoin(accounts, eq(accounts.id, bankAccounts.ledgerAccountId))
      .where(and(eq(bankTransactions.entityId, entityId), eq(bankTransactions.id, transactionId)))
      .limit(1)

    if (row === undefined) return null

    const entry: BankEntry = {
      amount: row.amount,
      currency: row.currency,
      bookingDate: row.bookingDate,
      valueDate: row.valueDate,
      bankReference: row.bankReference,
      endToEndId: row.endToEndId,
      counterpartyName: row.counterpartyName,
      counterpartyIban: row.counterpartyIban,
      description: row.description,
      remittanceReference: row.remittanceReference,
      transactionCode: row.transactionCode,
      raw: row.raw ?? '',
    }

    return { ...row, entry }
  }

  /**
   * Invoices a payment could be for, with what is still owed on each.
   *
   * Outstanding is the total less what has been allocated. That subtraction is
   * the reason `bank_transaction_allocations` exists, and it is what makes an
   * invoice stop being chased once it is paid.
   */
  async matchCandidates(entityId: string): Promise<readonly MatchCandidate[]> {
    const allocated = this.tx
      .select({
        invoiceId: bankTransactionAllocations.invoiceId,
        total: sql<string>`sum(${bankTransactionAllocations.amountMinorUnits})`.as('allocated'),
      })
      .from(bankTransactionAllocations)
      .where(eq(bankTransactionAllocations.entityId, entityId))
      .groupBy(bankTransactionAllocations.invoiceId)
      .as('allocated')

    const rows = await this.tx
      .select({
        invoiceId: salesInvoices.id,
        number: salesInvoices.number,
        kind: salesInvoices.kind,
        contactId: contacts.id,
        contactName: contacts.name,
        contactIban: contacts.iban,
        issueDate: salesInvoices.issueDate,
        dueDate: salesInvoices.dueDate,
        total: salesInvoices.totalMinorUnits,
        currency: salesInvoices.currency,
        allocated: allocated.total,
      })
      .from(salesInvoices)
      .innerJoin(contacts, eq(contacts.id, salesInvoices.contactId))
      .leftJoin(allocated, eq(allocated.invoiceId, salesInvoices.id))
      .where(and(eq(salesInvoices.entityId, entityId), eq(salesInvoices.status, 'issued')))
      .orderBy(asc(salesInvoices.dueDate))

    return rows
      .map((row) => ({
        invoiceId: row.invoiceId,
        number: row.number ?? '',
        kind: row.kind,
        contactId: row.contactId,
        contactName: row.contactName,
        contactIban: row.contactIban,
        issueDate: row.issueDate,
        dueDate: row.dueDate,
        outstanding: row.total - BigInt(row.allocated ?? '0'),
        currency: row.currency,
      }))
      .filter((candidate) => candidate.outstanding > 0n)
  }

  async listRules(entityId: string): Promise<readonly MatchRule[]> {
    const rows = await this.tx
      .select({
        id: bankMatchRules.id,
        source: bankMatchRules.source,
        counterpartyIban: bankMatchRules.counterpartyIban,
        counterpartyName: bankMatchRules.counterpartyName,
        descriptionContains: bankMatchRules.descriptionContains,
        accountNumber: accounts.number,
        contactId: bankMatchRules.contactId,
        timesApplied: bankMatchRules.timesApplied,
        isActive: bankMatchRules.isActive,
      })
      .from(bankMatchRules)
      .leftJoin(accounts, eq(accounts.id, bankMatchRules.accountId))
      .where(eq(bankMatchRules.entityId, entityId))
      .orderBy(desc(bankMatchRules.timesApplied), asc(bankMatchRules.id))

    return rows.map((row) => ({
      ...row,
      source: row.source === 'manual' ? 'manual' : 'learned',
    }))
  }

  /**
   * Remember what a human chose, or bump the rule that already says it.
   *
   * `onConflictDoUpdate` on the condition set, so learning the same thing twice
   * raises the confidence rather than growing a pile of duplicate rules nobody
   * can read. That is what "visible and editable" needs to stay true.
   */
  async learnRule(request: {
    readonly entityId: string
    readonly counterpartyIban: string | null
    readonly counterpartyName: string | null
    readonly descriptionContains: string | null
    readonly accountId: string | null
    readonly contactId: string | null
  }): Promise<void> {
    await this.tx
      .insert(bankMatchRules)
      .values({
        id: uuidv7(),
        source: 'learned',
        timesApplied: 1,
        lastAppliedAt: new Date(),
        ...request,
      })
      .onConflictDoUpdate({
        target: [
          bankMatchRules.entityId,
          bankMatchRules.counterpartyIban,
          bankMatchRules.counterpartyName,
          bankMatchRules.descriptionContains,
        ],
        set: {
          accountId: request.accountId,
          contactId: request.contactId,
          timesApplied: sql`${bankMatchRules.timesApplied} + 1`,
          lastAppliedAt: new Date(),
          isActive: true,
          updatedAt: new Date().toISOString(),
        },
      })
  }

  async setRuleActive(entityId: string, ruleId: string, isActive: boolean): Promise<boolean> {
    const updated = await this.tx
      .update(bankMatchRules)
      .set({ isActive, updatedAt: new Date().toISOString() })
      .where(and(eq(bankMatchRules.entityId, entityId), eq(bankMatchRules.id, ruleId)))
      .returning({ id: bankMatchRules.id })

    return updated.length > 0
  }

  async bumpRule(entityId: string, ruleId: string): Promise<void> {
    await this.tx
      .update(bankMatchRules)
      .set({
        timesApplied: sql`${bankMatchRules.timesApplied} + 1`,
        lastAppliedAt: new Date(),
      })
      .where(and(eq(bankMatchRules.entityId, entityId), eq(bankMatchRules.id, ruleId)))
  }

  /**
   * Record that a transaction has been matched.
   *
   * The journal entry is posted by the caller through `postJournalEntry`, in
   * the same transaction. This links it and writes the allocations — and does
   * nothing else, because the entry is what makes it true in the books.
   */
  async recordMatch(request: {
    readonly entityId: string
    readonly transactionId: string
    readonly journalEntryId: string
    readonly allocations: readonly { invoiceId: string; amount: bigint }[]
  }): Promise<void> {
    await this.tx
      .update(bankTransactions)
      .set({
        status: 'matched',
        journalEntryId: request.journalEntryId,
        matchedAt: new Date(),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(bankTransactions.entityId, request.entityId),
          eq(bankTransactions.id, request.transactionId),
        ),
      )

    for (const allocation of request.allocations) {
      const amount = allocation.amount < 0n ? -allocation.amount : allocation.amount
      if (amount === 0n) continue
      await this.tx.insert(bankTransactionAllocations).values({
        id: uuidv7(),
        entityId: request.entityId,
        transactionId: request.transactionId,
        invoiceId: allocation.invoiceId,
        amountMinorUnits: amount,
      })
    }
  }

  /** Mark a line as deliberately not booked. Not the same as unmatched. */
  async ignoreTransaction(entityId: string, transactionId: string): Promise<boolean> {
    const updated = await this.tx
      .update(bankTransactions)
      .set({ status: 'ignored', updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(bankTransactions.entityId, entityId),
          eq(bankTransactions.id, transactionId),
          eq(bankTransactions.status, 'unmatched'),
        ),
      )
      .returning({ id: bankTransactions.id })

    return updated.length > 0
  }

  /** What has been allocated against an invoice, for the outstanding sum. */
  async allocatedFor(
    entityId: string,
    invoiceIds: readonly string[],
  ): Promise<Map<string, bigint>> {
    if (invoiceIds.length === 0) return new Map()

    const rows = await this.tx
      .select({
        invoiceId: bankTransactionAllocations.invoiceId,
        total: sql<string>`sum(${bankTransactionAllocations.amountMinorUnits})::text`,
      })
      .from(bankTransactionAllocations)
      .where(
        and(
          eq(bankTransactionAllocations.entityId, entityId),
          inArray(bankTransactionAllocations.invoiceId, [...invoiceIds]),
        ),
      )
      .groupBy(bankTransactionAllocations.invoiceId)

    return new Map(rows.map((row) => [row.invoiceId, BigInt(row.total)]))
  }

  /** A contact whose IBAN matches, for a rule that names a contact. */
  async contactByIban(entityId: string, iban: string): Promise<string | null> {
    const [row] = await this.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.entityId, entityId), eq(contacts.iban, normaliseIbanForMatch(iban))))
      .limit(1)
    return row?.id ?? null
  }
}
