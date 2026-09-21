/**
 * Which roles may do the things a screen offers.
 *
 * The permissions are the truth and they live in `@klopt/core`, whose barrel
 * drags in `node:crypto` and `node:fs` and cannot reach a browser. So the roles
 * that hold each permission are written out here, and
 * `test/unit/roles.test.ts` asks `permissionsForRole` whether the lists are
 * still right — the same trick the fiscal-year dates use, for the same reason:
 * a copy nobody checks is a copy that drifts.
 *
 * ## This is not the gate
 *
 * Every handler calls `requirePermission` and refuses regardless, which is where
 * the security lives (`apps/web/src/api/handlers/*`). These lists exist so that a
 * refusal arrives **before** somebody chooses a year and an account and ticks an
 * acknowledgement, rather than after — and so that a screen does not print a
 * button whose only outcome is 403. Hiding an action nobody may take is politeness;
 * the handler refusing it is the rule.
 *
 * Nav entries use the same lists, so what the sidebar offers and what the screen
 * will do cannot disagree.
 */

/** `ledger:close`. Closing a year is the accountant's act, and the owner's. */
export const MAY_CLOSE_YEAR: readonly string[] = ['owner', 'accountant']

/**
 * `ledger:configure`. Opening the next year includes the bookkeeper on purpose:
 * "a bookkeeper whose year rolled over cannot post into the new year without
 * operator help" is the sentence #6 exists because of.
 */
export const MAY_OPEN_YEAR: readonly string[] = ['owner', 'accountant', 'bookkeeper']

/** `ledger:import`. Reading an auditfile in writes journal entries. */
export const MAY_IMPORT_AUDIT_FILE: readonly string[] = ['owner', 'accountant']

/** `ledger:export`. Everybody who may read the books may take them with them. */
export const MAY_EXPORT_AUDIT_FILE: readonly string[] = [
  'owner',
  'accountant',
  'bookkeeper',
  'auditor',
]

export function may(roles: readonly string[], role: string): boolean {
  return roles.includes(role)
}
