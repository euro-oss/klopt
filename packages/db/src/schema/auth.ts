import { sql } from 'drizzle-orm'
import { boolean, index, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { klopt } from './schema.js'
import { entities } from './ledger.js'

/**
 * Authentication (spec 11, 14).
 *
 * The four tables better-auth needs, plus one of ours. Column names follow
 * better-auth's expectations rather than the repository's own conventions —
 * fighting a library over `emailVerified` versus `email_verified` buys nothing.
 *
 * Ids are `text` here, not `uuid`: better-auth generates them, and letting it
 * is less trouble than overriding it everywhere.
 *
 * "Do not build a bespoke session system" (spec 11). This is the whole of it.
 */

export const users = klopt.table('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export const sessions = klopt.table(
  'sessions',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Which entity's books this session is currently looking at. */
    activeEntityId: uuid('active_entity_id').references(() => entities.id),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('sessions_user').on(table.userId)],
)

export const accounts_ = klopt.table(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    /**
     * Required by better-auth 1.7. Its expected shape is read from
     * `getAuthTables()` rather than guessed — a missing column here fails at
     * sign-up with a runtime error, not at build time.
     */
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    scope: text('scope'),
    /** Argon2 hash for local accounts. Null for OIDC. */
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('auth_accounts_user').on(table.userId)],
)

export const verifications = klopt.table('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

/**
 * Who may see whose books, and as what.
 *
 * Per-entity rather than global (spec 4: "role-based with per-entity scoping"),
 * because multi-entity within one instance is the norm for holdings and BV
 * structures — and because an external accountant should reach exactly the
 * entities they were invited to and no others.
 */
export const entityMembers = klopt.table(
  'entity_members',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('entity_members_unique').on(table.entityId, table.userId),
    index('entity_members_user').on(table.userId),
  ],
)

/**
 * An invitation, which is a membership waiting for an account to attach to.
 *
 * Invitations are keyed by **email**, not by user id, because the person being
 * invited usually has no account yet — and in a system whose only credential is
 * a code sent to an address, an address is the whole of an identity. There is
 * no accept-link and no invitation token: the address in the row is the same
 * address the one-time code goes to, so proving control of the mailbox is
 * already the whole of accepting. A separate token would be a second, weaker
 * credential for the same fact. See docs/decisions/0015.
 *
 * The row is kept after it is claimed rather than deleted, so that "who let
 * this accountant in, and when" survives them being removed again.
 */
export const entityInvitations = klopt.table(
  'entity_invitations',
  {
    id: uuid('id').primaryKey(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id),
    /** Lower-cased on write. Matching an invitation must not turn on case. */
    email: text('email').notNull(),
    role: text('role').notNull(),
    invitedByUserId: text('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    acceptedUserId: text('accepted_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    // One live invitation per address per entity. Partial, so a second one can
    // be issued after the first is claimed or revoked.
    uniqueIndex('entity_invitations_pending')
      .on(table.entityId, table.email)
      .where(sql`accepted_at is null and revoked_at is null`),
    index('entity_invitations_email').on(table.email),
  ],
)
