/**
 * Drizzle schema.
 *
 * Everything lives in the `klopt` schema rather than `public`, so that a future
 * multi-tenant deployment mode can add a schema per tenant alongside row-level
 * security without a rename (spec 14). That decision has to be made before the
 * first data-access code exists, which is here.
 *
 * No tables yet — the ledger arrives in M0.
 */
import { pgSchema } from 'drizzle-orm/pg-core'

export const klopt = pgSchema('klopt')

export * from './columns.js'
