import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
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
   * When true, emailOTP will not create an account for an unknown address.
   * Open by default so a fresh install can create the first user; set
   * `KLOPT_SIGNUP=closed` once the firm is on the instance (audit M3).
   */
  readonly disableSignUp?: boolean
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
  readonly action: 'auth.codeRequested' | 'auth.signedIn' | 'auth.signedOut'
  /** The address it concerns. The only identifier a failed attempt has. */
  readonly email: string
  readonly userId: string | null
}

/**
 * Who is signing out, carried from the `before` hook to the `after` one.
 *
 * A `WeakMap` keyed on the endpoint context, which better-auth hands to both:
 * one entry per in-flight request, collected with it, and no chance of two
 * concurrent sign-outs reading each other's.
 */
const signingOut = new WeakMap<object, { email: string; userId: string }>()

/**
 * The key both hooks agree on.
 *
 * `createAuthMiddleware` builds a fresh wrapper per invocation, so the `ctx`
 * the `before` hook sees is not the one `after` sees — a `WeakMap` keyed on it
 * finds nothing. `ctx.context` is the object the dispatcher writes `returned`
 * onto, which makes it the request, and the request is the scope this wants:
 * two people signing out at once must not read each other's.
 */
function requestOf(ctx: unknown): object {
  const inner = (ctx as Returned).context
  return inner ?? (ctx as object)
}

/** The one field of a hook's context this reads that its type omits. */
interface Returned {
  readonly context?: { readonly returned?: unknown }
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
        // A first-time address gets an account unless signup is closed.
        // Closing it after the firm is on the instance stops strangers from
        // provisioning their own books on a URL that was meant to be private
        // (audit M3). Invite-by-address still adds people to an existing entity.
        disableSignUp: config.disableSignUp ?? false,
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
     * Signing out, which has no database hook (ADR 0049).
     *
     * `databaseHooks` are create and update only, so the session's deletion is
     * invisible there. The request hooks see every endpoint, including the one
     * `auth.api.signOut` dispatches through — which matters, because this
     * application signs out two ways: a plain form posting to `/sign-out`, and
     * any API client posting to `/api/auth/sign-out`. One hook covers both.
     *
     * Split across `before` and `after` on purpose. `before` is the last
     * moment the session still exists, so it is the only place to learn whose
     * it was; `after` is the only place that knows the sign-out succeeded. An
     * audit line for a sign-out that failed would be a lie, and this log's
     * whole value is that it is not one.
     */
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-out') return
        // The library's own resolution rather than reading the cookie here:
        // it knows how the token is signed and which name it goes under.
        // Swallowed, because observing a sign-out must never prevent one.
        const session = await getSessionFromCtx(ctx).catch(() => null)
        if (session === null) return
        signingOut.set(requestOf(ctx), { email: session.user.email, userId: session.user.id })
      }),
      after: createAuthMiddleware(async (ctx) => {
        const key = requestOf(ctx)
        const who = signingOut.get(key)
        signingOut.delete(key)
        if (who === undefined) return

        // The endpoint answers `{ success: true }`. Anything else — an expired
        // session, a database that refused — is not a sign-out, and must not
        // be written down as one.
        const returned: unknown = (ctx as Returned).context?.returned
        const succeeded =
          typeof returned === 'object' &&
          returned !== null &&
          (returned as { success?: unknown }).success === true
        if (!succeeded) return

        await config.onAuthEvent?.({
          action: 'auth.signedOut',
          email: who.email,
          userId: who.userId,
        })
      }),
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
