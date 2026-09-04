import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { postJournalEntry, systemClock, uuidv7, type Actor } from '@klopt/core'
import { sql } from 'drizzle-orm'
import { withLedger } from '../src/unit-of-work.js'
import { periods } from '../src/schema/index.js'
import { and, eq } from 'drizzle-orm'
import { createFixture, type Fixture } from './support/fixture.js'
import { expectDatabaseError } from './support/errors.js'

/**
 * The database guards, exercised with raw SQL.
 *
 * Everything here deliberately goes around the posting API. That is the point:
 * these invariants have to hold for a psql session, a future module that forgot
 * the posting API, and anyone who has the connection string. A test that only
 * ever goes through the application proves the application, not the guarantee.
 */

const actor: Actor = { kind: 'human', id: 'user_1', principalId: null }

let fixture: Fixture

beforeAll(async () => {
  fixture = await createFixture()
}, 60_000)

afterAll(async () => {
  await fixture.close()
})

async function postSomething(entityId = fixture.entityId, bookingDate = '2026-03-15') {
  return withLedger(fixture.database, (repository) =>
    postJournalEntry(
      {
        entityId,
        journalCode: 'MEM',
        bookingDate,
        documentDate: bookingDate,
        description: 'Guard test',
        sourceDocumentRef: null,
        reversesEntryId: null,
        lines: [
          {
            accountNumber: '1100',
            description: null,
            debit: 100_00n,
            credit: 0n,
            currency: null,
            exchangeRate: null,
            exchangeRateSource: null,
            taxCode: null,
            taxAmount: null,
            dimensions: [],
            subledgerKind: null,
            subledgerId: null,
          },
          {
            accountNumber: '8000',
            description: null,
            debit: 0n,
            credit: 100_00n,
            currency: null,
            exchangeRate: null,
            exchangeRateSource: null,
            taxCode: null,
            taxAmount: null,
            dimensions: [],
            subledgerKind: null,
            subledgerId: null,
          },
        ],
      },
      actor,
      {
        dryRun: false,
        idempotencyKey: uuidv7(),
        requestId: null,
        ip: null,
        mayPostToSoftClosedPeriod: false,
      },
      { repository, clock: systemClock },
    ),
  )
}

describe('the journal is append-only', () => {
  it('refuses UPDATE on a posted entry', async () => {
    const { entry } = await postSomething()

    await expectDatabaseError(
      fixture.database.execute(
        sql`update klopt.journal_entries set description = 'tampered' where id = ${entry.id}::uuid`,
      ),
      /append-only/,
    )
  })

  it('refuses DELETE on a posted entry', async () => {
    const { entry } = await postSomething()

    await expectDatabaseError(
      fixture.database.execute(sql`delete from klopt.journal_entries where id = ${entry.id}::uuid`),
      /append-only/,
    )
  })

  it('refuses UPDATE on a posted line', async () => {
    const { entry } = await postSomething()
    const lineId = entry.lines[0]!.id

    await expectDatabaseError(
      fixture.database.execute(
        sql`update klopt.journal_lines set debit_minor_units = 1 where id = ${lineId}::uuid`,
      ),
      /append-only/,
    )
  })

  it('refuses to rewrite the audit log', async () => {
    await postSomething()

    await expectDatabaseError(
      fixture.database.execute(
        sql`delete from klopt.audit_log where entity_id = ${fixture.entityId}::uuid`,
      ),
      /append-only/,
    )
  })
})

describe('entries must balance, even inserted by hand', () => {
  it('refuses an unbalanced entry written directly', async () => {
    const entityId = fixture.entityId

    await expectDatabaseError(
      fixture.database.transaction(async (tx) => {
        const [period] = await tx
          .select({ id: periods.id, fiscalYearId: periods.fiscalYearId })
          .from(periods)
          .where(and(eq(periods.entityId, entityId), eq(periods.sequence, 5)))
          .limit(1)

        await tx.execute(sql`
          insert into klopt.journal_entries (
            id, entity_id, journal_id, fiscal_year_id, period_id, entry_number,
            chain_sequence, booking_date, document_date, description,
            functional_currency, actor_kind, actor_id, hash, previous_hash, created_at
          )
          select ${uuidv7()}::uuid, ${entityId}::uuid, j.id, ${period!.fiscalYearId}::uuid,
                 ${period!.id}::uuid, 9999,
                 (select coalesce(max(chain_sequence), 0) + 1 from klopt.journal_entries where entity_id = ${entityId}::uuid),
                 '2026-05-01', '2026-05-01', 'Hand-written and wrong',
                 'EUR', 'human', 'sql', repeat('a', 64),
                 (select hash from klopt.journal_entries where entity_id = ${entityId}::uuid order by chain_sequence desc limit 1),
                 now()
          from klopt.journals j
          where j.entity_id = ${entityId}::uuid and j.code = 'MEM'
        `)
      }),
      /at least two/,
    )
  })
})

describe('the hash chain cannot be spliced', () => {
  it('refuses an entry whose previous_hash does not match its predecessor', async () => {
    const entity = await createFixture()
    try {
      await withLedger(entity.database, (repository) =>
        postJournalEntry(
          {
            entityId: entity.entityId,
            journalCode: 'MEM',
            bookingDate: '2026-03-15',
            documentDate: '2026-03-15',
            description: 'First',
            sourceDocumentRef: null,
            reversesEntryId: null,
            lines: [
              {
                accountNumber: '1100',
                description: null,
                debit: 100_00n,
                credit: 0n,
                currency: null,
                exchangeRate: null,
                exchangeRateSource: null,
                taxCode: null,
                taxAmount: null,
                dimensions: [],
                subledgerKind: null,
                subledgerId: null,
              },
              {
                accountNumber: '8000',
                description: null,
                debit: 0n,
                credit: 100_00n,
                currency: null,
                exchangeRate: null,
                exchangeRateSource: null,
                taxCode: null,
                taxAmount: null,
                dimensions: [],
                subledgerKind: null,
                subledgerId: null,
              },
            ],
          },
          actor,
          {
            dryRun: false,
            idempotencyKey: uuidv7(),
            requestId: null,
            ip: null,
            mayPostToSoftClosedPeriod: false,
          },
          { repository, clock: systemClock },
        ),
      )

      const [period] = await entity.database
        .select({ id: periods.id, fiscalYearId: periods.fiscalYearId })
        .from(periods)
        .where(and(eq(periods.entityId, entity.entityId), eq(periods.sequence, 4)))
        .limit(1)

      await expectDatabaseError(
        entity.database.execute(sql`
          insert into klopt.journal_entries (
            id, entity_id, journal_id, fiscal_year_id, period_id, entry_number,
            chain_sequence, booking_date, document_date, description,
            functional_currency, actor_kind, actor_id, hash, previous_hash, created_at
          )
          select ${uuidv7()}::uuid, ${entity.entityId}::uuid, j.id,
                 ${period!.fiscalYearId}::uuid, ${period!.id}::uuid, 500,
                 2, '2026-04-01', '2026-04-01', 'Spliced in',
                 'EUR', 'human', 'sql', repeat('b', 64), repeat('c', 64), now()
          from klopt.journals j
          where j.entity_id = ${entity.entityId}::uuid and j.code = 'MEM'
        `),
        /chain break/,
      )
    } finally {
      await entity.close()
    }
  })
})

describe('period control', () => {
  it('refuses a posting into a hard-closed period, from the application', async () => {
    const entity = await createFixture()
    try {
      await entity.database
        .update(periods)
        .set({ status: 'hard_closed' })
        .where(and(eq(periods.entityId, entity.entityId), eq(periods.sequence, 3)))

      await expect(
        withLedger(entity.database, (repository) =>
          postJournalEntry(
            {
              entityId: entity.entityId,
              journalCode: 'MEM',
              bookingDate: '2026-03-15',
              documentDate: '2026-03-15',
              description: 'Into a closed period',
              sourceDocumentRef: null,
              reversesEntryId: null,
              lines: [
                {
                  accountNumber: '1100',
                  description: null,
                  debit: 100_00n,
                  credit: 0n,
                  currency: null,
                  exchangeRate: null,
                  exchangeRateSource: null,
                  taxCode: null,
                  taxAmount: null,
                  dimensions: [],
                  subledgerKind: null,
                  subledgerId: null,
                },
                {
                  accountNumber: '8000',
                  description: null,
                  debit: 0n,
                  credit: 100_00n,
                  currency: null,
                  exchangeRate: null,
                  exchangeRateSource: null,
                  taxCode: null,
                  taxAmount: null,
                  dimensions: [],
                  subledgerKind: null,
                  subledgerId: null,
                },
              ],
            },
            actor,
            {
              dryRun: false,
              idempotencyKey: uuidv7(),
              requestId: null,
              ip: null,
              mayPostToSoftClosedPeriod: false,
            },
            { repository, clock: systemClock },
          ),
        ),
      ).rejects.toMatchObject({ code: 'period_hard_closed' })
    } finally {
      await entity.close()
    }
  })

  it('refuses it from raw SQL too', async () => {
    const entity = await createFixture()
    try {
      await entity.database
        .update(periods)
        .set({ status: 'hard_closed' })
        .where(and(eq(periods.entityId, entity.entityId), eq(periods.sequence, 3)))

      const [period] = await entity.database
        .select({ id: periods.id, fiscalYearId: periods.fiscalYearId })
        .from(periods)
        .where(and(eq(periods.entityId, entity.entityId), eq(periods.sequence, 3)))
        .limit(1)

      await expectDatabaseError(
        entity.database.execute(sql`
          insert into klopt.journal_entries (
            id, entity_id, journal_id, fiscal_year_id, period_id, entry_number,
            chain_sequence, booking_date, document_date, description,
            functional_currency, actor_kind, actor_id, hash, created_at
          )
          select ${uuidv7()}::uuid, ${entity.entityId}::uuid, j.id,
                 ${period!.fiscalYearId}::uuid, ${period!.id}::uuid, 1,
                 1, '2026-03-15', '2026-03-15', 'Straight past the API',
                 'EUR', 'human', 'sql', repeat('a', 64), now()
          from klopt.journals j
          where j.entity_id = ${entity.entityId}::uuid and j.code = 'MEM'
        `),
        /hard-closed/,
      )
    } finally {
      await entity.close()
    }
  })

  it('refuses a booking date outside the period it claims', async () => {
    const entity = await createFixture()
    try {
      const [period] = await entity.database
        .select({ id: periods.id, fiscalYearId: periods.fiscalYearId })
        .from(periods)
        .where(and(eq(periods.entityId, entity.entityId), eq(periods.sequence, 3)))
        .limit(1)

      await expectDatabaseError(
        entity.database.execute(sql`
          insert into klopt.journal_entries (
            id, entity_id, journal_id, fiscal_year_id, period_id, entry_number,
            chain_sequence, booking_date, document_date, description,
            functional_currency, actor_kind, actor_id, hash, created_at
          )
          select ${uuidv7()}::uuid, ${entity.entityId}::uuid, j.id,
                 ${period!.fiscalYearId}::uuid, ${period!.id}::uuid, 1,
                 1, '2026-09-15', '2026-09-15', 'March period, September date',
                 'EUR', 'human', 'sql', repeat('a', 64), now()
          from klopt.journals j
          where j.entity_id = ${entity.entityId}::uuid and j.code = 'MEM'
        `),
        /outside period/,
      )
    } finally {
      await entity.close()
    }
  })

  it('lets an accountant post to a soft-closed period, and nobody else', async () => {
    const entity = await createFixture()
    try {
      await entity.database
        .update(periods)
        .set({ status: 'soft_closed' })
        .where(and(eq(periods.entityId, entity.entityId), eq(periods.sequence, 3)))

      const cmd = {
        entityId: entity.entityId,
        journalCode: 'MEM',
        bookingDate: '2026-03-15',
        documentDate: '2026-03-15',
        description: 'Adjusting entry',
        sourceDocumentRef: null,
        reversesEntryId: null,
        lines: [
          {
            accountNumber: '1100',
            description: null,
            debit: 100_00n,
            credit: 0n,
            currency: null,
            exchangeRate: null,
            exchangeRateSource: null,
            taxCode: null,
            taxAmount: null,
            dimensions: [],
            subledgerKind: null,
            subledgerId: null,
          },
          {
            accountNumber: '8000',
            description: null,
            debit: 0n,
            credit: 100_00n,
            currency: null,
            exchangeRate: null,
            exchangeRateSource: null,
            taxCode: null,
            taxAmount: null,
            dimensions: [],
            subledgerKind: null,
            subledgerId: null,
          },
        ],
      }

      await expect(
        withLedger(entity.database, (repository) =>
          postJournalEntry(
            cmd,
            actor,
            {
              dryRun: false,
              idempotencyKey: uuidv7(),
              requestId: null,
              ip: null,
              mayPostToSoftClosedPeriod: false,
            },
            { repository, clock: systemClock },
          ),
        ),
      ).rejects.toMatchObject({ code: 'period_soft_closed' })

      const allowed = await withLedger(entity.database, (repository) =>
        postJournalEntry(
          cmd,
          actor,
          {
            dryRun: false,
            idempotencyKey: uuidv7(),
            requestId: null,
            ip: null,
            mayPostToSoftClosedPeriod: true,
          },
          { repository, clock: systemClock },
        ),
      )
      expect(allowed.entry.periodSequence).toBe(3)
    } finally {
      await entity.close()
    }
  })
})
