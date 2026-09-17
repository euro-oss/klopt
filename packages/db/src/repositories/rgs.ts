import { uuidv7, type MappableAccount } from '@klopt/core'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import {
  accountPeriodBalances,
  accounts,
  auditLog,
  entities,
  journalEntries,
  yearCloses,
} from '../schema/index.js'

/**
 * RGS mapping and year-close persistence.
 *
 * Mapping lives on the account (`accounts.rgs_code`) rather than in a join
 * table: an account has exactly one RGS code, and RGS's own indirect mapping —
 * the omslagcode — is a property of the code, not a second mapping.
 */
export class RgsRepository {
  constructor(private readonly tx: Transaction) {}

  /** The chart with its current balances, which coverage needs to weight by. */
  async mappableAccounts(entityId: string, currency: string): Promise<MappableAccount[]> {
    const rows = await this.tx
      .select({
        number: accounts.number,
        name: accounts.name,
        normalBalance: accounts.normalBalance,
        rgsCode: accounts.rgsCode,
        debit: sql<string>`coalesce(sum(${accountPeriodBalances.debitMinorUnits}), 0)`,
        credit: sql<string>`coalesce(sum(${accountPeriodBalances.creditMinorUnits}), 0)`,
      })
      .from(accounts)
      .leftJoin(
        accountPeriodBalances,
        and(
          eq(accountPeriodBalances.accountId, accounts.id),
          eq(accountPeriodBalances.currency, currency),
        ),
      )
      .where(eq(accounts.entityId, entityId))
      .groupBy(accounts.number, accounts.name, accounts.normalBalance, accounts.rgsCode)

    return rows.map((row) => ({
      number: row.number,
      name: row.name,
      normalBalance: row.normalBalance,
      rgsCode: row.rgsCode,
      balance: BigInt(row.debit) - BigInt(row.credit),
    }))
  }

  async currentMappings(entityId: string) {
    return this.tx
      .select({ accountNumber: accounts.number, rgsCode: accounts.rgsCode })
      .from(accounts)
      .where(eq(accounts.entityId, entityId))
  }

  /**
   * Apply mappings. Not append-only — the chart of accounts is configuration,
   * not the journal — but every change is written to the audit log, because an
   * accountant who finds last quarter's export mapped differently needs to be
   * able to find out when and by whom.
   */
  async applyMappings(request: {
    readonly entityId: string
    readonly actorId: string
    readonly actorKind: 'human' | 'script' | 'agent'
    readonly principalId: string | null
    readonly requestId: string | null
    readonly mappings: readonly {
      readonly accountNumber: string
      readonly rgsCode: string | null
    }[]
  }): Promise<number> {
    if (request.mappings.length === 0) return 0

    const numbers = request.mappings.map((mapping) => mapping.accountNumber)
    const existing = await this.tx
      .select({ id: accounts.id, number: accounts.number, rgsCode: accounts.rgsCode })
      .from(accounts)
      .where(and(eq(accounts.entityId, request.entityId), inArray(accounts.number, numbers)))

    const byNumber = new Map(existing.map((account) => [account.number, account]))
    const missing = numbers.filter((number) => !byNumber.has(number))
    if (missing.length > 0) {
      throw new Error(`No such account(s): ${missing.join(', ')}.`)
    }

    let changed = 0

    for (const mapping of request.mappings) {
      const account = byNumber.get(mapping.accountNumber)!
      if (account.rgsCode === mapping.rgsCode) continue

      await this.tx
        .update(accounts)
        .set({ rgsCode: mapping.rgsCode, updatedAt: new Date().toISOString() })
        .where(eq(accounts.id, account.id))

      await this.tx.insert(auditLog).values({
        id: uuidv7(),
        entityId: request.entityId,
        actorKind: request.actorKind,
        actorId: request.actorId,
        actorPrincipalId: request.principalId,
        action: 'rgs.setMapping',
        resourceType: 'account',
        resourceId: account.id,
        before: { accountNumber: account.number, rgsCode: account.rgsCode },
        after: { accountNumber: account.number, rgsCode: mapping.rgsCode },
        requestId: request.requestId,
        ip: null,
      })

      changed += 1
    }

    return changed
  }

  async setRgsVersion(entityId: string, version: string, variant: string): Promise<void> {
    await this.tx
      .update(entities)
      .set({ rgsVersion: version, rgsVariant: variant, updatedAt: new Date().toISOString() })
      .where(eq(entities.id, entityId))
  }

  async recordYearClose(request: {
    readonly entityId: string
    readonly fiscalYearId: string
    readonly appropriationEntryId: string | null
    readonly openingEntryId: string | null
    readonly result: bigint
    readonly currency: string
    readonly closedBy: string
  }): Promise<string> {
    const id = uuidv7()
    await this.tx.insert(yearCloses).values({
      id,
      entityId: request.entityId,
      fiscalYearId: request.fiscalYearId,
      appropriationEntryId: request.appropriationEntryId,
      openingEntryId: request.openingEntryId,
      resultMinorUnits: request.result,
      resultCurrency: request.currency,
      closedBy: request.closedBy,
    })
    return id
  }

  async findOpenClose(fiscalYearId: string) {
    const [row] = await this.tx
      .select()
      .from(yearCloses)
      .where(and(eq(yearCloses.fiscalYearId, fiscalYearId), sql`${yearCloses.reversedAt} is null`))
      .limit(1)
    return row ?? null
  }

  async listCloses(entityId: string) {
    return this.tx
      .select({
        id: yearCloses.id,
        fiscalYearId: yearCloses.fiscalYearId,
        appropriationEntryId: yearCloses.appropriationEntryId,
        openingEntryId: yearCloses.openingEntryId,
        result: yearCloses.resultMinorUnits,
        currency: yearCloses.resultCurrency,
        closedAt: yearCloses.closedAt,
        closedBy: yearCloses.closedBy,
        reversedAt: yearCloses.reversedAt,
      })
      .from(yearCloses)
      .where(eq(yearCloses.entityId, entityId))
  }

  /** Sanity check before recording a close: the entries must actually exist. */
  async entriesExist(entityId: string, ids: readonly string[]): Promise<boolean> {
    const present = ids.filter((id) => id !== '')
    if (present.length === 0) return true
    const rows = await this.tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(eq(journalEntries.entityId, entityId), inArray(journalEntries.id, present)))
    return rows.length === present.length
  }
}
