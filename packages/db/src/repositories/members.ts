import {
  assertKeepsAnOwner,
  invitationExpiry,
  normaliseEmail,
  uuidv7,
  violation,
  LedgerError,
  type Member,
  type Role,
} from '@klopt/core'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '../client.js'
import { entityInvitations, entityMembers, users } from '../schema/auth.js'
import { auditLog } from '../schema/ledger.js'

/**
 * Who can see an administration's books.
 *
 * Two kinds of row, one list: a **member** is somebody with an account, a
 * **pending invitation** is an address that has been let in but has not signed
 * in yet. The screen shows them together because the distinction is not one the
 * person doing the inviting has any reason to care about.
 *
 * Every change writes an audit row (spec 7.6). Access grants are exactly the
 * thing an auditor asks about after the fact, and "who let this accountant in"
 * has to survive the accountant being removed again.
 */

export interface Actor {
  readonly kind: 'human' | 'script' | 'agent'
  readonly id: string
  readonly principalId: string | null
  readonly requestId: string | null
  readonly ip: string | null
}

export interface MemberRow {
  readonly kind: 'member'
  readonly userId: string
  readonly email: string
  readonly name: string
  readonly role: string
  readonly since: string
}

export interface InvitationRow {
  readonly kind: 'invitation'
  readonly invitationId: string
  readonly email: string
  readonly role: string
  readonly invitedAt: string
  readonly expiresAt: string
  readonly expired: boolean
}

export interface InviteRequest {
  readonly entityId: string
  readonly email: string
  readonly role: Role
  readonly actor: Actor
}

export interface InviteResult {
  readonly invitationId: string
  readonly email: string
  readonly role: Role
  readonly expiresAt: Date
  /** True when the address already had an account and is now simply a member. */
  readonly joinedImmediately: boolean
  /** False when this re-sent an invitation that was already outstanding. */
  readonly created: boolean
}

export class MembersRepository {
  constructor(private readonly database: Database) {}

  private async audit(
    actor: Actor,
    entityId: string,
    action: string,
    resourceId: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    await this.database.insert(auditLog).values({
      id: uuidv7(),
      entityId,
      actorKind: actor.kind,
      actorId: actor.id,
      actorPrincipalId: actor.principalId,
      action,
      resourceType: 'entity_member',
      resourceId,
      before: before ?? null,
      after: after ?? null,
      requestId: actor.requestId,
      ip: actor.ip,
    })
  }

  /** Roles only, for the last-owner check. */
  private async membersOf(entityId: string): Promise<Member[]> {
    const rows = await this.database
      .select({ userId: entityMembers.userId, role: entityMembers.role })
      .from(entityMembers)
      .where(eq(entityMembers.entityId, entityId))

    // The column is `text`, so the role is whatever is in the database until
    // something checks it. The owner count is what matters here and an unknown
    // role is not an owner, so a cast is honest.
    return rows.map((row) => ({ userId: row.userId, role: row.role as Role }))
  }

  async list(entityId: string): Promise<{
    members: readonly MemberRow[]
    invitations: readonly InvitationRow[]
  }> {
    const members = await this.database
      .select({
        userId: entityMembers.userId,
        email: users.email,
        name: users.name,
        role: entityMembers.role,
        since: entityMembers.createdAt,
      })
      .from(entityMembers)
      .innerJoin(users, eq(users.id, entityMembers.userId))
      .where(eq(entityMembers.entityId, entityId))
      .orderBy(asc(users.email))

    const invitations = await this.database
      .select({
        invitationId: entityInvitations.id,
        email: entityInvitations.email,
        role: entityInvitations.role,
        invitedAt: entityInvitations.createdAt,
        expiresAt: entityInvitations.expiresAt,
      })
      .from(entityInvitations)
      .where(
        and(
          eq(entityInvitations.entityId, entityId),
          isNull(entityInvitations.acceptedAt),
          isNull(entityInvitations.revokedAt),
        ),
      )
      .orderBy(asc(entityInvitations.email))

    const now = Date.now()

    return {
      members: members.map((row) => ({
        kind: 'member' as const,
        userId: row.userId,
        email: row.email,
        name: row.name,
        role: row.role,
        since: row.since.toISOString(),
      })),
      // Expired invitations are shown rather than hidden: "I invited them and
      // nothing happened" is the case where seeing the row matters most.
      invitations: invitations.map((row) => ({
        kind: 'invitation' as const,
        invitationId: row.invitationId,
        email: row.email,
        role: row.role,
        invitedAt: row.invitedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        expired: row.expiresAt.getTime() < now,
      })),
    }
  }

  /**
   * Invite an address.
   *
   * If it already has an account, it becomes a member on the spot — there is
   * nothing to wait for, and making somebody who already signs in here go
   * through an acceptance step is ceremony. Otherwise the invitation waits for
   * a first sign-in to claim it.
   */
  async invite(request: InviteRequest): Promise<InviteResult> {
    const email = normaliseEmail(request.email)

    const [existing] = await this.database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    if (existing !== undefined) {
      const [already] = await this.database
        .select({ role: entityMembers.role })
        .from(entityMembers)
        .where(
          and(eq(entityMembers.entityId, request.entityId), eq(entityMembers.userId, existing.id)),
        )
        .limit(1)

      if (already !== undefined && already.role === request.role) {
        return {
          invitationId: existing.id,
          email,
          role: request.role,
          expiresAt: new Date(),
          joinedImmediately: true,
          created: false,
        }
      }

      await this.database
        .insert(entityMembers)
        .values({
          id: uuidv7(),
          entityId: request.entityId,
          userId: existing.id,
          role: request.role,
        })
        .onConflictDoUpdate({
          target: [entityMembers.entityId, entityMembers.userId],
          set: { role: request.role },
        })

      await this.audit(
        request.actor,
        request.entityId,
        already === undefined ? 'members.invite' : 'members.setRole',
        existing.id,
        already === undefined ? null : { role: already.role },
        { email, role: request.role },
      )

      return {
        invitationId: existing.id,
        email,
        role: request.role,
        expiresAt: new Date(),
        joinedImmediately: true,
        created: true,
      }
    }

    const [outstanding] = await this.database
      .select({ id: entityInvitations.id, role: entityInvitations.role })
      .from(entityInvitations)
      .where(
        and(
          eq(entityInvitations.entityId, request.entityId),
          eq(entityInvitations.email, email),
          isNull(entityInvitations.acceptedAt),
          isNull(entityInvitations.revokedAt),
        ),
      )
      .limit(1)

    const expiresAt = invitationExpiry()

    if (outstanding !== undefined) {
      // Re-inviting refreshes the clock and the role rather than failing. The
      // commonest reason to invite the same address twice is that the first
      // message did not arrive.
      await this.database
        .update(entityInvitations)
        .set({ role: request.role, expiresAt })
        .where(eq(entityInvitations.id, outstanding.id))

      await this.audit(
        request.actor,
        request.entityId,
        'members.invite',
        outstanding.id,
        { email, role: outstanding.role },
        { email, role: request.role },
      )

      return {
        invitationId: outstanding.id,
        email,
        role: request.role,
        expiresAt,
        joinedImmediately: false,
        created: false,
      }
    }

    const invitationId = uuidv7()
    await this.database.insert(entityInvitations).values({
      id: invitationId,
      entityId: request.entityId,
      email,
      role: request.role,
      invitedByUserId: request.actor.kind === 'human' ? request.actor.id : null,
      expiresAt,
    })

    await this.audit(request.actor, request.entityId, 'members.invite', invitationId, null, {
      email,
      role: request.role,
    })

    return {
      invitationId,
      email,
      role: request.role,
      expiresAt,
      joinedImmediately: false,
      created: true,
    }
  }

  async setRole(
    entityId: string,
    userId: string,
    role: Role,
    actor: Actor,
  ): Promise<{ userId: string; role: Role }> {
    const members = await this.membersOf(entityId)
    const current = members.find((member) => member.userId === userId)

    if (current === undefined) {
      throw new LedgerError([
        violation(
          'unknown_member',
          'userId',
          'That person is not a member of this administration.',
        ),
      ])
    }

    assertKeepsAnOwner(members, userId, role)

    await this.database
      .update(entityMembers)
      .set({ role })
      .where(and(eq(entityMembers.entityId, entityId), eq(entityMembers.userId, userId)))

    await this.audit(actor, entityId, 'members.setRole', userId, { role: current.role }, { role })

    return { userId, role }
  }

  /** Revoke a membership, or withdraw an invitation that was never used. */
  async remove(
    entityId: string,
    subject: { userId?: string; invitationId?: string },
    actor: Actor,
  ): Promise<{ removed: 'member' | 'invitation' }> {
    if (subject.invitationId !== undefined) {
      const [invitation] = await this.database
        .select({ email: entityInvitations.email, role: entityInvitations.role })
        .from(entityInvitations)
        .where(
          and(
            eq(entityInvitations.id, subject.invitationId),
            eq(entityInvitations.entityId, entityId),
            isNull(entityInvitations.acceptedAt),
            isNull(entityInvitations.revokedAt),
          ),
        )
        .limit(1)

      if (invitation === undefined) {
        throw new LedgerError([
          violation('unknown_invitation', 'invitationId', 'There is no such open invitation.'),
        ])
      }

      // Revoked, not deleted: "who was invited and then un-invited" is a
      // question an audit asks, and a deleted row cannot answer it.
      await this.database
        .update(entityInvitations)
        .set({ revokedAt: new Date() })
        .where(eq(entityInvitations.id, subject.invitationId))

      await this.audit(
        actor,
        entityId,
        'members.revokeInvitation',
        subject.invitationId,
        { email: invitation.email, role: invitation.role },
        null,
      )

      return { removed: 'invitation' }
    }

    const userId = subject.userId
    if (userId === undefined) {
      throw new LedgerError([violation('unknown_member', 'userId', 'Say who is being removed.')])
    }

    const members = await this.membersOf(entityId)
    const current = members.find((member) => member.userId === userId)
    if (current === undefined) {
      throw new LedgerError([
        violation(
          'unknown_member',
          'userId',
          'That person is not a member of this administration.',
        ),
      ])
    }

    assertKeepsAnOwner(members, userId, null)

    await this.database
      .delete(entityMembers)
      .where(and(eq(entityMembers.entityId, entityId), eq(entityMembers.userId, userId)))

    // A session pointed at books it can no longer see would resolve to a 404 on
    // every request. Sending it back to the picker is kinder and no less safe.
    await this.database.execute(
      sql`update klopt.sessions set active_entity_id = null
          where user_id = ${userId} and active_entity_id = ${entityId}`,
    )

    await this.audit(actor, entityId, 'members.remove', userId, { role: current.role }, null)

    return { removed: 'member' }
  }
}

/**
 * Turn this user's outstanding invitations into memberships.
 *
 * Called at sign-in rather than on every request: it is a write, and the only
 * moment the answer can change is when an account first attaches to an address.
 * Idempotent, and safe to call for a user with nothing waiting — which is
 * almost every sign-in.
 */
export async function claimInvitations(
  database: Database,
  userId: string,
  email: string,
): Promise<number> {
  const address = normaliseEmail(email)
  const now = new Date()

  const pending = await database
    .select({
      id: entityInvitations.id,
      entityId: entityInvitations.entityId,
      role: entityInvitations.role,
      expiresAt: entityInvitations.expiresAt,
    })
    .from(entityInvitations)
    .where(
      and(
        eq(entityInvitations.email, address),
        isNull(entityInvitations.acceptedAt),
        isNull(entityInvitations.revokedAt),
      ),
    )

  let claimed = 0

  for (const invitation of pending) {
    // Expired invitations stay visible to the inviter rather than being swept
    // up here: they are the evidence that the invitation was never used.
    if (invitation.expiresAt.getTime() < now.getTime()) continue

    await database
      .insert(entityMembers)
      .values({
        id: uuidv7(),
        entityId: invitation.entityId,
        userId,
        role: invitation.role,
      })
      .onConflictDoNothing({ target: [entityMembers.entityId, entityMembers.userId] })

    await database
      .update(entityInvitations)
      .set({ acceptedAt: now, acceptedUserId: userId })
      .where(eq(entityInvitations.id, invitation.id))

    await database.insert(auditLog).values({
      id: uuidv7(),
      entityId: invitation.entityId,
      actorKind: 'human',
      actorId: userId,
      actorPrincipalId: null,
      action: 'members.acceptInvitation',
      resourceType: 'entity_member',
      resourceId: userId,
      before: null,
      after: { email: address, role: invitation.role },
      requestId: null,
      ip: null,
    })

    claimed += 1
  }

  return claimed
}
