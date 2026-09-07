import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { klopt } from './schema.js'
import { entities, vatPeriodKind } from './ledger.js'

export const vatFilingState = klopt.enum('vat_filing_state', ['draft', 'filed', 'superseded'])

/**
 * A filed BTW-aangifte, stored as what was declared.
 *
 * Not a pointer to a recomputation. The return is a pure function of the
 * journal, which means recomputing a filed period may give a different answer
 * — and when it does, a suppletie is owed (spec 7.2). Keeping the snapshot is
 * the only way to know.
 *
 * The rubrieken, the reconciliation and the findings are stored as JSON rather
 * than normalised into rows because they are evidence: the shape they had at
 * filing time is the shape that must come back, even after the domain model
 * around them has moved on.
 */
export const vatFilings = klopt.table(
  'vat_filings',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    periodFrom: date('period_from').notNull(),
    periodTo: date('period_to').notNull(),
    kind: vatPeriodKind('kind').notNull(),
    state: vatFilingState('state').notNull().default('draft'),
    /** 1 is the original aangifte, 2 the first suppletie, and so on. */
    sequence: integer('sequence').notNull().default(1),
    /** A suppletie points at the filing it corrects. */
    supersedesId: uuid('supersedes_id'),
    owedMinorUnits: bigint('owed_minor_units', { mode: 'bigint' }).notNull(),
    deductibleMinorUnits: bigint('deductible_minor_units', { mode: 'bigint' }).notNull(),
    payableMinorUnits: bigint('payable_minor_units', { mode: 'bigint' }).notNull(),
    rubrieken: jsonb('rubrieken').notNull(),
    reconciliation: jsonb('reconciliation').notNull(),
    findings: jsonb('findings').notNull(),
    /** Who accepted the warnings, and why. Blocking findings cannot be accepted. */
    acceptedWarningsBy: text('accepted_warnings_by'),
    acceptedWarningsReason: text('accepted_warnings_reason'),
    filedBy: text('filed_by'),
    filedAt: timestamp('filed_at', { withTimezone: true }),
    /** Which FilingTransport carried it: digipoort, sbr_provider or manual. */
    transport: text('transport'),
    transportReference: text('transport_reference'),
    /**
     * The delivery's current state, denormalised from `filing_submissions` so a
     * list of periods needs no history join. The history remains the truth.
     */
    deliveryStatus: text('delivery_status'),
    taxonomyVersion: text('taxonomy_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('vat_filings_period', sql`${table.periodTo} >= ${table.periodFrom}`),
    unique('vat_filings_period_sequence').on(
      table.entityId,
      table.periodFrom,
      table.periodTo,
      table.sequence,
    ),
  ],
)
