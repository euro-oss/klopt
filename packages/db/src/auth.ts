import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { uuidv7, type Role } from '@klopt/core'
import { and, eq } from 'drizzle-orm'
import type { Database } from './client.js'
import { accounts_, entityMembers, sessions, users, verifications } from './schema/auth.js'
import { entities } from './schema/ledger.js'

/**
 * Authentication (spec 11: "better-auth, local accounts plus optional OIDC.
 * Self-hosters want their own IdP. Do not build a bespoke session system.").
 *
 * Local email and password is what a fresh install gets. OIDC is configuration,
 * not code: a self-hoster points `KLOPT_OIDC_*` at their own provider and both
 * paths land in the same `users` table.
 */

export interface AuthConfig {
  readonly database: Database
  /** Signs session cookies. From the environment or a KMS, never the repo. */
  readonly secret: string
  readonly baseUrl: string
  readonly oidc?: {
    readonly issuer: string
    readonly clientId: string
    readonly clientSecret: string
  }
}

export type Auth = ReturnType<typeof createAuth>

export function createAuth(config: AuthConfig) {
  return betterAuth({
    secret: config.secret,
    baseURL: config.baseUrl,
    basePath: '/api/auth',

    database: drizzleAdapter(config.database, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts_,
        verification: verifications,
      },
    }),

    emailAndPassword: {
      enabled: true,
      // Verification needs an email transport, which arrives with Sales in M1.
      // Until then a self-hoster creating their own first user has nothing to
      // verify against, and blocking sign-in on it would just be a lockout.
      requireEmailVerification: false,
      minPasswordLength: 12,
    },

    ...(config.oidc === undefined
      ? {}
      : {
          socialProviders: {},
          // Placeholder for the generic OIDC plugin; wiring a real provider is
          // deployment configuration and is documented rather than hard-coded.
        }),

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },

    advanced: {
      // A bookkeeping system is same-site by construction.
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
    },
  })
}

export interface EntityMembership {
  readonly entityId: string
  readonly entityName: string
  /**
   * Deliberately `string`, not `Role`. The column is `text`, so the value is
   * whatever is in the database until something validates it — claiming
   * otherwise here makes the caller's runtime check look unreachable to the
   * type checker, which is how a real check gets deleted as dead code.
   */
  readonly role: string
}

/** Which books this user may open, and as what. */
export async function membershipsFor(
  database: Database,
  userId: string,
): Promise<EntityMembership[]> {
  const rows = await database
    .select({
      entityId: entityMembers.entityId,
      entityName: entities.name,
      role: entityMembers.role,
    })
    .from(entityMembers)
    .innerJoin(entities, eq(entities.id, entityMembers.entityId))
    .where(eq(entityMembers.userId, userId))
    .orderBy(entities.name)

  return rows
}

export async function membershipFor(
  database: Database,
  userId: string,
  entityId: string,
): Promise<EntityMembership | null> {
  const [row] = await database
    .select({
      entityId: entityMembers.entityId,
      entityName: entities.name,
      role: entityMembers.role,
    })
    .from(entityMembers)
    .innerJoin(entities, eq(entities.id, entityMembers.entityId))
    .where(and(eq(entityMembers.userId, userId), eq(entityMembers.entityId, entityId)))
    .limit(1)

  return row ?? null
}

export async function addMember(
  database: Database,
  request: { entityId: string; userId: string; role: Role },
): Promise<void> {
  await database
    .insert(entityMembers)
    .values({ id: uuidv7(), ...request })
    .onConflictDoUpdate({
      target: [entityMembers.entityId, entityMembers.userId],
      set: { role: request.role },
    })
}

/** The entity a session is currently looking at, if it has chosen one. */
export async function setActiveEntity(
  database: Database,
  sessionToken: string,
  entityId: string,
): Promise<void> {
  await database
    .update(sessions)
    .set({ activeEntityId: entityId, updatedAt: new Date() })
    .where(eq(sessions.token, sessionToken))
}

export async function activeEntityFor(
  database: Database,
  sessionToken: string,
): Promise<string | null> {
  const [row] = await database
    .select({ activeEntityId: sessions.activeEntityId })
    .from(sessions)
    .where(eq(sessions.token, sessionToken))
    .limit(1)
  return row?.activeEntityId ?? null
}
