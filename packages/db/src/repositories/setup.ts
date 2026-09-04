import {
  planFiscalYear,
  uuidv7,
  type EntitySetupPlan,
  type FiscalYearLayout,
  type Role,
} from '@klopt/core'
import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '../client.js'
import { entityMembers } from '../schema/auth.js'
import { accounts, entities, fiscalYears, journals, periods } from '../schema/ledger.js'
import { taxCodes } from '../schema/sales.js'

/**
 * Provisioning an administration.
 *
 * The whole thing is one transaction on purpose. A half-created entity — books
 * with journals but no periods, or accounts but no owner — is worse than none:
 * it is reachable from the UI and rejects everything you try to do in it, with
 * an error about the wrong subject.
 *
 * Nothing here decides anything. `planEntitySetup` in @klopt/core did that; this
 * writes the plan and returns.
 */

export interface ProvisionEntityRequest {
  /**
   * Chosen by the caller, which is what makes creation idempotent: a retried
   * request lands on the administration the first one made rather than a second
   * one. There is no other way to dedupe this — the idempotency table is keyed
   * by entity, and there is no entity yet.
   */
  readonly entityId: string
  readonly ownerUserId: string
  readonly plan: EntitySetupPlan
}

export interface PeriodSummary {
  readonly sequence: number
  readonly startsOn: string
  readonly endsOn: string
  readonly status: 'open' | 'soft_closed' | 'hard_closed'
}

export interface FiscalYearSummary {
  readonly code: string
  readonly startsOn: string
  readonly endsOn: string
  readonly status: 'open' | 'closed'
  readonly periods: readonly PeriodSummary[]
}

export interface ProvisionedEntity {
  readonly entityId: string
  readonly name: string
  /** False when the entity already existed, i.e. this was a retry. */
  readonly created: boolean
}

export class SetupRepository {
  constructor(private readonly database: Database) {}

  /** Does this id already name an administration this user is a member of? */
  private async existing(
    entityId: string,
    userId: string,
  ): Promise<{ id: string; name: string } | null> {
    const [row] = await this.database
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .innerJoin(entityMembers, eq(entityMembers.entityId, entities.id))
      .where(and(eq(entities.id, entityId), eq(entityMembers.userId, userId)))
      .limit(1)
    return row ?? null
  }

  async provision(request: ProvisionEntityRequest): Promise<ProvisionedEntity> {
    const { entityId, plan } = request

    const already = await this.existing(entityId, request.ownerUserId)
    if (already !== null) {
      return { entityId, name: already.name, created: false }
    }

    await this.database.insert(entities).values({
      id: entityId,
      name: plan.entity.name,
      legalName: plan.entity.legalName,
      kvkNumber: plan.entity.kvkNumber,
      vatNumber: plan.entity.vatNumber,
      functionalCurrency: plan.entity.functionalCurrency,
      fiscalYearStartMonth: plan.entity.fiscalYearStartMonth,
      rgsVersion: plan.entity.rgsVersion,
      rgsVariant: plan.entity.rgsVariant,
      vatRounding: plan.entity.vatRounding,
    })

    // The creator owns it. Without this row the entity exists and nobody can
    // see it, which is the one failure mode with no route back.
    await this.database.insert(entityMembers).values({
      id: uuidv7(),
      entityId,
      userId: request.ownerUserId,
      role: 'owner' satisfies Role,
    })

    await this.writeFiscalYear(entityId, plan.fiscalYear)

    await this.database.insert(journals).values(
      plan.journals.map((journal) => ({
        id: uuidv7(),
        entityId,
        code: journal.code,
        name: journal.name,
        type: journal.type,
      })),
    )

    const accountIds = new Map<string, string>()
    await this.database.insert(accounts).values(
      plan.accounts.map((account) => {
        const id = uuidv7()
        accountIds.set(account.number, id)
        return {
          id,
          entityId,
          number: account.number,
          name: account.name,
          type: account.type,
          normalBalance: account.normalBalance,
          rgsCode: account.rgsCode,
        }
      }),
    )

    if (plan.taxCodes.length > 0) {
      await this.database.insert(taxCodes).values(
        plan.taxCodes.map((code) => ({
          id: uuidv7(),
          entityId,
          code: code.code,
          description: code.description,
          rateBasisPoints: code.rateBasisPoints,
          direction: code.direction,
          accountId: accountIds.get(code.accountNumber) ?? null,
          isReverseCharge: code.isReverseCharge,
          ublCategory: code.ublCategory,
          validFrom: code.validFrom,
        })),
      )
    }

    return { entityId, name: plan.entity.name, created: true }
  }

  private async writeFiscalYear(entityId: string, layout: FiscalYearLayout): Promise<void> {
    const fiscalYearId = uuidv7()
    await this.database.insert(fiscalYears).values({
      id: fiscalYearId,
      entityId,
      code: layout.code,
      startsOn: layout.startsOn,
      endsOn: layout.endsOn,
    })

    await this.database.insert(periods).values(
      layout.periods.map((period) => ({
        id: uuidv7(),
        entityId,
        fiscalYearId,
        sequence: period.sequence,
        startsOn: period.startsOn,
        endsOn: period.endsOn,
      })),
    )
  }

  /**
   * Open another book year.
   *
   * Needed on its own because a year close posts the opening balance into the
   * *next* year, so an entity that has only ever had one year cannot close it.
   * Idempotent by the year code: asking twice for 2027 returns the 2027 that
   * exists, and never a second one.
   */
  async createFiscalYear(
    entityId: string,
    code: string,
  ): Promise<{ code: string; startsOn: string; endsOn: string; created: boolean }> {
    const [entity] = await this.database
      .select({ startMonth: entities.fiscalYearStartMonth })
      .from(entities)
      .where(eq(entities.id, entityId))
      .limit(1)

    const layout = planFiscalYear(code, entity?.startMonth ?? 1)

    const [present] = await this.database
      .select({ startsOn: fiscalYears.startsOn, endsOn: fiscalYears.endsOn })
      .from(fiscalYears)
      .where(and(eq(fiscalYears.entityId, entityId), eq(fiscalYears.code, code)))
      .limit(1)

    if (present !== undefined) {
      return { code, startsOn: present.startsOn, endsOn: present.endsOn, created: false }
    }

    await this.writeFiscalYear(entityId, layout)
    return { code, startsOn: layout.startsOn, endsOn: layout.endsOn, created: true }
  }

  async listFiscalYears(entityId: string): Promise<readonly FiscalYearSummary[]> {
    const years = await this.database
      .select({
        id: fiscalYears.id,
        code: fiscalYears.code,
        startsOn: fiscalYears.startsOn,
        endsOn: fiscalYears.endsOn,
        status: fiscalYears.status,
      })
      .from(fiscalYears)
      .where(eq(fiscalYears.entityId, entityId))
      .orderBy(asc(fiscalYears.code))

    const rows = await this.database
      .select({
        fiscalYearId: periods.fiscalYearId,
        sequence: periods.sequence,
        startsOn: periods.startsOn,
        endsOn: periods.endsOn,
        status: periods.status,
      })
      .from(periods)
      .where(eq(periods.entityId, entityId))
      .orderBy(asc(periods.sequence))

    return years.map((year) => ({
      code: year.code,
      startsOn: year.startsOn,
      endsOn: year.endsOn,
      status: year.status,
      periods: rows
        .filter((period) => period.fiscalYearId === year.id)
        .map((period) => ({
          sequence: period.sequence,
          startsOn: period.startsOn,
          endsOn: period.endsOn,
          status: period.status,
        })),
    }))
  }
}
