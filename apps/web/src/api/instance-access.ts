import { normaliseEmail } from '@klopt/core'

/**
 * Instance-scoped access: signup mode and who may create administrations.
 *
 * `entity:create` is not held by any role (ADR 0014). When signup is open,
 * every signed-in human gets it — that is the first-install path. When
 * signup is closed, only addresses listed in `KLOPT_INSTANCE_ADMINS` get it.
 * An Eigenaar of some administration is not an instance admin; the list is
 * never inferred from "first user" or from holding a role anywhere.
 */

export type EnvBag = Readonly<Record<string, string | undefined>>

/** `KLOPT_SIGNUP=closed` means invite-only sign-in and gated entity creation. */
export function isSignupClosed(env: EnvBag = process.env): boolean {
  return env['KLOPT_SIGNUP'] === 'closed'
}

/**
 * Emails that may create administrations when signup is closed.
 *
 * Comma-separated, trimmed, case-insensitive. Empty (or unset) means nobody —
 * fail closed, so a closed instance with no admins configured cannot grow.
 */
export function parseInstanceAdmins(value: string | undefined): ReadonlySet<string> {
  if (value === undefined || value.trim() === '') return new Set()
  const emails = value
    .split(',')
    .map((part) => normaliseEmail(part))
    .filter((part) => part !== '')
  return new Set(emails)
}

export function isInstanceAdmin(email: string, env: EnvBag = process.env): boolean {
  return parseInstanceAdmins(env['KLOPT_INSTANCE_ADMINS']).has(normaliseEmail(email))
}

/**
 * May this signed-in address create a new administration?
 *
 * Open signup: yes, for every session (first-install path). Closed signup:
 * only instance admins.
 */
export function mayCreateEntity(email: string, env: EnvBag = process.env): boolean {
  if (!isSignupClosed(env)) return true
  return isInstanceAdmin(email, env)
}
