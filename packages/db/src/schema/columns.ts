/**
 * Shared column builders. Conventions that every table needs, defined once so
 * they cannot drift between modules (spec 9, point 4).
 */
import { sql } from 'drizzle-orm'
import { bigint, char, timestamp, uuid } from 'drizzle-orm/pg-core'

/** Primary key. UUIDv7 so ids sort by creation time without leaking a count. */
export const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`)

/**
 * Money, always stored as two columns (spec 6.1). `bigint` with `mode: 'bigint'`
 * is load-bearing: Drizzle's default number mode would hand back a float.
 */
export const moneyColumns = (name: string) => ({
  [`${name}MinorUnits`]: bigint(`${name}_minor_units`, { mode: 'bigint' }).notNull(),
  [`${name}Currency`]: char(`${name}_currency`, { length: 3 }).notNull(),
})

/** Audit stamps. `createdAt` is set by the database so a clock-skewed app cannot lie. */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}
