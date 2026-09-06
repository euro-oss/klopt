import { PERMISSIONS, requireEmail, requireRole, type Role } from '@klopt/core'
import { withMembers } from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { getEmailTransport } from '../email.js'
import { ApiError } from '../errors.js'
import type { InviteMemberBody, SetMemberRoleBody } from '../schemas.js'

/**
 * Managing who can see an administration's books (spec 4).
 *
 * Owner-only throughout, because membership is the one setting that can lock
 * everybody else out — including the person changing it. The rule that stops
 * that, "an administration always has at least one owner", lives in
 * `@klopt/core` and is checked inside the transaction; nothing here decides it.
 */

function requireOwner(context: RequestContext): void {
  if (!hasPermission(context, PERMISSIONS.manageMembers)) {
    throw new ApiError('forbidden', 'Only an owner can manage who has access.')
  }
}

const ROLE_LABELS: Readonly<Record<Role, string>> = {
  owner: 'eigenaar',
  bookkeeper: 'boekhouder',
  accountant: 'accountant',
  auditor: 'controleur',
}

function actorFor(context: RequestContext) {
  return {
    kind: context.actor.kind,
    id: context.actor.id,
    principalId: context.actor.principalId,
    requestId: context.requestId,
    ip: context.ip,
  }
}

export async function handleListMembers(context: RequestContext) {
  requireOwner(context)

  const result = await withMembers(context.database, (repository) =>
    repository.list(context.entityId),
  )

  return { status: 200, body: result }
}

/**
 * Invite an address.
 *
 * The message is sent **after** the transaction commits, not inside it. A mail
 * relay that is slow holds a serializable transaction open; a mail relay that
 * fails would roll back an invitation that is, as far as the database is
 * concerned, perfectly good — and the invitee can still sign in and claim it
 * without ever seeing the message. So a delivery failure is reported alongside
 * a successful invitation rather than instead of one.
 */
export async function handleInviteMember(context: RequestContext, body: InviteMemberBody) {
  requireOwner(context)

  const email = requireEmail(body.email)
  const role = requireRole(body.role)

  const result = await withMembers(context.database, (repository) =>
    repository.invite({ entityId: context.entityId, email, role, actor: actorFor(context) }),
  )

  let delivered = false
  let deliveryError: string | null = null
  // Which transport handled it, so the caller can tell "there is no mail server
  // here" from "the mail server said no". They need different words.
  let transport: string | null = null

  if (!result.joinedImmediately) {
    const baseUrl = process.env['KLOPT_BASE_URL'] ?? 'http://localhost:3000'
    try {
      const outcome = await getEmailTransport().send({
        to: email,
        subject: `Je bent uitgenodigd voor een administratie in Klopt`,
        text: [
          `Je bent uitgenodigd als ${ROLE_LABELS[role]} voor een administratie in Klopt.`,
          '',
          `Meld je aan met dit e-mailadres (${email}) en de administratie staat voor je klaar:`,
          '',
          `    ${baseUrl}/sign-in`,
          '',
          'Er is geen wachtwoord. Je vult je e-mailadres in en krijgt een code.',
          '',
          `De uitnodiging verloopt op ${result.expiresAt.toISOString().slice(0, 10)}.`,
          '',
          'Heb je hier niet om gevraagd? Dan kun je dit bericht negeren — zonder',
          'toegang tot deze mailbox kan niemand er iets mee.',
        ].join('\n'),
        reference: `invitation:${result.invitationId}`,
      })
      delivered = outcome.delivered
      transport = outcome.transport
    } catch (error: unknown) {
      deliveryError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    status: result.created ? 201 : 200,
    body: {
      email: result.email,
      role: result.role,
      joinedImmediately: result.joinedImmediately,
      expiresAt: result.joinedImmediately ? null : result.expiresAt.toISOString(),
      invitationId: result.joinedImmediately ? null : result.invitationId,
      delivered,
      transport,
      deliveryError,
    },
  }
}

export async function handleSetMemberRole(
  context: RequestContext,
  memberId: string,
  body: SetMemberRoleBody,
) {
  requireOwner(context)

  const result = await withMembers(context.database, (repository) =>
    repository.setRole(context.entityId, memberId, requireRole(body.role), actorFor(context)),
  )

  return { status: 200, body: result }
}

/**
 * Remove a member, or withdraw an invitation nobody used.
 *
 * One id, two kinds of subject. The list returns both under the same `id`, so
 * the caller does not have to know which it is holding — an invitation is
 * resolved first, and anything else is treated as a user.
 */
export async function handleRemoveMember(context: RequestContext, memberId: string) {
  requireOwner(context)

  const result = await withMembers(context.database, async (repository) => {
    const { invitations } = await repository.list(context.entityId)
    const invitation = invitations.find((item) => item.invitationId === memberId)

    return repository.remove(
      context.entityId,
      invitation === undefined ? { userId: memberId } : { invitationId: memberId },
      actorFor(context),
    )
  })

  return { status: 200, body: result }
}
