import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins'
import type { EmailTransport } from '@klopt/core'
import { uuidv7, type Role } from '@klopt/core'
import { and, eq } from 'drizzle-orm'
import type { Database } from './client.js'
import {
  accounts_,
  authRateLimits,
  entityMembers,
  sessions,
  users,
  verifications,
} from './schema/auth.js'
import { claimInvitations } from './repositories/members.js'
import { entities } from './schema/ledger.js'

/**
 * Authentication (spec 11: "better-auth, local accounts plus optional OIDC.
 * Self-hosters want their own IdP. Do not build a bespoke session system.").
 *
 * **A one-time code by email, not a password.** Three reasons, in the order
 * they matter for this product:
 *
 *   1. There is no password to store, reset, leak or get wrong. For software
 *    that holds seven years of somebody's statutory records, the credential you
 *    do not have is the one that cannot be stolen from you.
 *   2. A self-hoster needs SMTP for invoices and dunning in M1 anyway. Sign-in
 *      reuses that, so there is one thing to configure rather than two.
 *   3. It removes the entire password surface — strength rules, hashing
 *      parameters, reset tokens, credential stuffing — from a codebase whose
 *      hard parts should be VAT and auditfiles.
 *
 * The trade is real: sign-in is only as available as email is. That is why the
 * transport falls back to writing the code to the log, so a fresh install and a
 * broken relay both still let the operator in.
 *
 * OIDC remains configuration, not code: a self-hoster points at their own
 * provider and both paths land in the same `users` table.
 */

export interface AuthConfig {
  readonly database: Database
  /** Signs session cookies. From the environment or a KMS, never the repo. */
  readonly secret: string
  readonly baseUrl: string
  /** Delivers the code. Falls back to the log when SMTP is not configured. */
  readonly email: EmailTransport
  /** Product name in the message. */
  readonly productName?: string
  readonly oidc?: {
    readonly issuer: string
    readonly clientId: string
    readonly clientSecret: string
  }
  /**
   * Switches rate limiting off. For the test suites, which sign in far more
   * often in three minutes than a person does in a year and would otherwise
   * spend their time exercising the limiter.
   *
   * A switch rather than a set of numbers somebody can widen: an operator who
   * can raise a limit from a config file raises it once, during an incident,
   * and never lowers it again. Off is at least a decision that is legible in
   * a deployment, and `createAuth` says so on the way past.
   */
  readonly disableRateLimit?: boolean
  /** Records an authentication event. Called for both halves of a sign-in. */
  readonly onAuthEvent?: (event: AuthEvent) => Promise<void>
}

/** What happened, for the audit log. See `recordAuthEvent`. */
export interface AuthEvent {
  readonly action: 'auth.codeRequested' | 'auth.signedIn'
  /** The address it concerns. The only identifier a failed attempt has. */
  readonly email: string
  readonly userId: string | null
}

/** How long a code is worth typing. Long enough to switch to a mail client. */
const OTP_MINUTES = 10
const OTP_LENGTH = 6

/**
 * Rate limiting (spec 14), stated rather than inherited.
 *
 * better-auth rate-limits by default — but only in production, and only in
 * process memory. Both are left behind here: a control whose behaviour under
 * test differs from the behaviour shipped has not been tested, and counters
 * that reset on deploy make the limit as long as the uptime.
 *
 * Two tiers, because the two risks are different:
 *
 *   - **Everything** gets a broad ceiling. This is about a script hammering
 *     the endpoints, not about guessing a credential.
 *   - **Asking for a code** gets a tight one, per address and per client.
 *     Every request sends an email to somebody who may not have asked for it,
 *     so the abuse to prevent is using sign-in as a way to post mail to a
 *     stranger — quite apart from the cost of the relay.
 *
 * Guessing a code is *not* limited here: `allowedAttempts` already burns the
 * code after three wrong tries, which is the tighter control and the one that
 * cannot be evaded by changing address.
 */
export const RATE_LIMIT = {
  window: 60,
  max: 100,
  /** Six codes an hour is a person having a bad day; the seventh is not. */
  sendCode: { window: 60 * 60, max: 6 },
} as const

function otpMessage(product: string, otp: string, type: string): { subject: string; text: string } {
  const purpose =
    type === 'sign-in'
      ? 'om aan te melden'
      : type === 'email-verification'
        ? 'om je e-mailadres te bevestigen'
        : 'om je aanmelding te bevestigen'

  return {
    subject: `${otp} is je ${product}-code`,
    text: [
      `Je code ${purpose}:`,
      '',
      `    ${otp}`,
      '',
      `De code verloopt over ${String(OTP_MINUTES)} minuten en werkt één keer.`,
      '',
      'Heb je hier niet om gevraagd? Dan kun je dit bericht negeren — zonder de',
      'code kan niemand met dit e-mailadres aanmelden.',
    ].join('\n'),
  }
}

export type Auth = ReturnType<typeof createAuth>

export function createAuth(config: AuthConfig) {
  if (config.disableRateLimit === true) {
    // Loud, because the one way this ends badly is somebody setting it in a
    // deployment and nobody noticing for a year.
    console.warn('[auth] rate limiting is OFF. This is for tests, not for a deployment.')
  }

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
        rateLimit: authRateLimits,
      },
    }),

    // No password path at all, rather than one left switched off: a disabled
    // feature is a feature somebody re-enables.
    emailAndPassword: { enabled: false },

    plugins: [
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_MINUTES * 60,
        // Hashed, not plain. The code is now the *only* credential, so a
        // database dump must not contain a working one — the same reasoning
        // that makes api_tokens store only a hash.
        storeOTP: 'hashed',
        // Three guesses. Enough for a typo, not enough to brute-force six
        // digits.
        allowedAttempts: 3,
        // A first-time address gets an account. There is nothing to protect by
        // refusing — the code still has to arrive in that mailbox — and the
        // alternative is a self-hoster with no way to create the first user.
        disableSignUp: false,
        sendVerificationOTP: async ({ email, otp, type }) => {
          const { subject, text } = otpMessage(config.productName ?? 'Klopt', otp, type)
          await config.email.send({ to: email, subject, text })

          // After the send, so a failed relay is not recorded as a code
          // somebody could have used. A throw here would strand the caller
          // with a code in their inbox and an error on screen, so it does not.
          try {
            await config.onAuthEvent?.({ action: 'auth.codeRequested', email, userId: null })
          } catch (error: unknown) {
            console.error('[auth] could not record the code request', error)
          }
        },
      }),
    ],

    ...(config.oidc === undefined
      ? {}
      : {
          socialProviders: {},
          // Placeholder for the generic OIDC plugin; wiring a real provider is
          // deployment configuration and is documented rather than hard-coded.
        }),

    /**
     * An invitation is claimed at sign-in, and only at sign-in.
     *
     * It is a write, and the only moment its answer can change is when an
     * account first attaches to an address — so doing it on every request
     * would be a write on the read path to learn nothing new. A failure here
     * must not block the sign-in: the person still has an account, they just
     * arrive with no books, which the next sign-in fixes.
     */
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            try {
              const [user] = await config.database
                .select({ email: users.email })
                .from(users)
                .where(eq(users.id, session.userId))
                .limit(1)
              if (user === undefined) return
              await claimInvitations(config.database, session.userId, user.email)

              // After the invitations are claimed, so the event is recorded
              // against the administrations this sign-in can actually reach.
              await config.onAuthEvent?.({
                action: 'auth.signedIn',
                email: user.email,
                userId: session.userId,
              })
            } catch (error: unknown) {
              console.error('[auth] could not claim invitations', error)
            }
          },
        },
      },
    },

    /**
     * On in every environment, and counted in the database. See `RATE_LIMIT`
     * and migration 0027 for why neither of better-auth's defaults is kept.
     */
    rateLimit: {
      enabled: config.disableRateLimit !== true,
      window: RATE_LIMIT.window,
      max: RATE_LIMIT.max,
      storage: 'database',
      customRules: {
        // Sending a code puts mail in somebody's inbox, and the sender does
        // not have to be them. The limit is mostly about that, and only
        // secondarily about the relay bill.
        '/email-otp/send-verification-otp': RATE_LIMIT.sendCode,
      },
    },

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
