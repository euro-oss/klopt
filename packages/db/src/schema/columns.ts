/**
 * Shared column builders. Conventions every table needs, defined once so they
 * cannot drift between modules (spec 9, point 4).
 */
import { bigint, char, timestamp } from 'drizzle-orm/pg-core'

/**
 * Money, always two columns (spec 6.1). `mode: 'bigint'` is load-bearing:
 * Drizzle's default number mode returns a float.
 */
export const moneyColumns = <TName extends string>(name: TName) => ({
  [`${name}MinorUnits`]: bigint(`${name}_minor_units`, { mode: 'bigint' }).notNull(),
  [`${name}Currency`]: char(`${name}_currency`, { length: 3 }).notNull(),
})

/** Audit stamps. Set by the database, so a clock-skewed application cannot lie. */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}
