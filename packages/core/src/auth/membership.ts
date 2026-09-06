import { violation, LedgerError } from '../errors.js'
import { isRole, type Role } from './roles.js'

/**
 * Who may be let into an administration, and on what terms (spec 4).
 *
 * The rules are here rather than in the repository because they are rules, and
 * because the interesting one is a safety property rather than a validation:
 * **an administration always has at least one owner.** Owner is the only role
 * that can manage membership, so an entity that loses its last owner is
 * unadministrable and there is no route back that does not involve SQL. Both
 * removing a member and demoting one can cause it, so both check.
 */

/** How long an invitation is worth honouring. */
export const INVITATION_DAYS = 14

export interface Member {
  readonly userId: string
  readonly role: Role
}

/**
 * Addresses are compared lower-cased and trimmed.
 *
 * The local part of an address is case-sensitive by RFC, and no mail provider
 * anybody uses treats it that way. Matching an invitation on case would mean an
 * invitation to `Jan@example.com` never being found by a sign-in as
 * `jan@example.com`, which reads to the invitee as the invitation being ignored.
 */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase()
}

// Deliberately permissive. Address validation by regex is a well-known way to
// reject real addresses; the code has to arrive in the mailbox regardless, and
// that is the check that matters.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

export function requireEmail(value: string, path = 'email'): string {
  const email = normaliseEmail(value)
  if (!EMAIL.test(email)) {
    throw new LedgerError([violation('invalid_email', path, 'That is not an email address.')])
  }
  return email
}

export function requireRole(value: string, path = 'role'): Role {
  if (!isRole(value)) {
    throw new LedgerError([
      violation('unknown_role', path, `Role must be owner, bookkeeper, accountant or auditor.`),
    ])
  }
  return value
}

/**
 * Would this leave the administration with no owner?
 *
 * `next` is the role the member would end up with, or null if they would be
 * removed altogether.
 */
export function wouldOrphanEntity(
  members: readonly Member[],
  userId: string,
  next: Role | null,
): boolean {
  const owners = members.filter((member) => member.role === 'owner')
  const isTheOnlyOwner = owners.length === 1 && owners[0]?.userId === userId
  return isTheOnlyOwner && next !== 'owner'
}

export function assertKeepsAnOwner(
  members: readonly Member[],
  userId: string,
  next: Role | null,
): void {
  if (!wouldOrphanEntity(members, userId, next)) return

  throw new LedgerError([
    violation(
      'last_owner',
      next === null ? 'userId' : 'role',
      next === null
        ? 'This is the last owner. Make somebody else an owner first.'
        : 'This is the last owner. An administration cannot be left without one.',
    ),
  ])
}

/** When an invitation issued now stops being honoured. */
export function invitationExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITATION_DAYS * 24 * 60 * 60 * 1000)
}
