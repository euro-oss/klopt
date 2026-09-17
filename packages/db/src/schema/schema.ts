import { pgSchema } from 'drizzle-orm/pg-core'

/**
 * Everything lives in the `klopt` schema rather than `public`, so a future
 * multi-tenant deployment mode can add a schema per tenant alongside row-level
 * security without a rename (ADR 0006). pg-boss gets `klopt_jobs`, so queue
 * tables never appear in a dump of the books.
 */
export const klopt = pgSchema('klopt')
