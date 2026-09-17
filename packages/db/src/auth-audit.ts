import { eq } from 'drizzle-orm'
import type { Database } from './client.js'
import type { AuthEvent } from './auth.js'
import { AuditRepository } from './repositories/audit.js'
import { entityMembers, users } from './schema/auth.js'

/**
 * Authentication in the audit log (spec 14: "rate limiting and full audit on
 * every authentication event").
 *
 * ## Where an auth event belongs
 *
 * Signing in is not an act inside a set of books: it happens before one is
 * chosen, and the address may reach several or none. But `entity_id = null`
 * for everything would put it out of reach of the audit screen, which filters
 * by administration — and it would be wrong to show it everywhere, because one
 * instance can hold the books of unrelated people. An accountant's practice
 * running two clients must not let one read the other's sign-ins.
 *
 * So the rule is: **an auth event is recorded against every administration the
 * address can reach.** One row each. That is the scope in which the fact
 * matters — "who opened my books, and when" — and it leaks nothing, because
 * the reader already has access to those books.
 *
 * An address that reaches nothing gets a single instance-scoped row. A code
 * requested for an address with no account is the shape of a probe, and it is
 * worth having even though no owner's screen will show it: it is in the export
 * and in the table, which is where somebody investigating actually looks.
 *
 * ## Why the address is recorded
 *
 * A failed or unrecognised attempt has no user id — the address is the only
 * identifier there is, and a security log that cannot say *which* address was
 * tried answers none of the questions it exists for.
 */
export async function recordAuthEvent(database: Database, event: AuthEvent): Promise<void> {
  const userId =
    event.userId ??
    (
      await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, event.email))
        .limit(1)
    )[0]?.id ??
    null

  const entityIds =
    userId === null
      ? []
      : (
          await database
            .select({ entityId: entityMembers.entityId })
            .from(entityMembers)
            .where(eq(entityMembers.userId, userId))
        ).map((row) => row.entityId)

  const actor = {
    kind: 'human' as const,
    // The address, not the id: it is the only identifier every auth event has,
    // and it is what somebody reading the log is looking for.
    id: event.email,
    principalId: null,
  }

  const shared = {
    actor,
    action: event.action,
    resourceType: 'auth',
    resourceId: userId ?? event.email,
    before: null,
    after: { email: event.email },
    requestId: null,
    ip: null,
  }

  await database.transaction(async (tx) => {
    const repository = new AuditRepository(tx)

    if (entityIds.length === 0) {
      await repository.appendInstanceEvent(shared)
      return
    }

    for (const entityId of entityIds) {
      await repository.append({ ...shared, entityId })
    }
  })
}
