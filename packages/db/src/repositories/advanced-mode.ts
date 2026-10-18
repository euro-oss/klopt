import { eq } from 'drizzle-orm'
import type { Database } from '../client.js'
import { users } from '../schema/auth.js'

/**
 * Per-user Geavanceerd preference (issue #44).
 *
 * Stored on `klopt.users.advanced_mode`:
 * - `null` — no explicit choice; the shell derives from the active role
 * - `true` / `false` — the user chose
 *
 * Callers must pass the authenticated session user id. Never accept a user id
 * from the client. Updates always filter by that id so one account cannot
 * overwrite another even if a caller mistakes the id.
 */

/** Explicit choice for this user, or null when the role default still applies. */
export async function advancedModeFor(database: Database, userId: string): Promise<boolean | null> {
  const [row] = await database
    .select({ advancedMode: users.advancedMode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  return row?.advancedMode ?? null
}

/** Remember an explicit Geavanceerd choice for this user only. */
export async function setAdvancedModeFor(
  database: Database,
  userId: string,
  enabled: boolean,
): Promise<void> {
  await database
    .update(users)
    .set({ advancedMode: enabled, updatedAt: new Date() })
    .where(eq(users.id, userId))
}
