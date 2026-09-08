/**
 * Roles and what they may do (spec 4).
 *
 * The four roles come straight from the users table in the requirements. What
 * matters here is that a role is **only** a named bundle of permissions: the
 * domain never asks "is this an accountant", it asks "may this actor post to a
 * soft-closed period". Roles are how a human is granted permissions; scoped API
 * tokens are how a machine is. Both produce the same permission strings, and
 * everything downstream sees one shape.
 *
 * That is what makes principle 3 hold. A UI session and an API token differ in
 * how they authenticate and in nothing else.
 */

export const PERMISSIONS = {
  /** Read the ledger, the chart, the reports. */
  read: 'ledger:read',
  /** Post journal entries into an open period. */
  post: 'ledger:post',
  /** Post into a soft-closed period. The accountant's adjusting entries. */
  postClosed: 'ledger:post-closed',
  /** Run a year close. */
  close: 'ledger:close',
  /** Change the chart of accounts, dimensions and RGS mappings. */
  configure: 'ledger:configure',
  /** Produce an XAF or CSV export. */
  export: 'ledger:export',
  /** Import an auditfile. */
  import: 'ledger:import',
  /** Issue and revoke API tokens. */
  manageTokens: 'tokens:manage',
  /**
   * Invite, re-role and remove the people who can see these books. Owner only:
   * membership is the one thing that can lock everybody else out.
   */
  manageMembers: 'members:manage',
  /** Prepare a payment batch, and submit it for approval. */
  preparePayments: 'payments:prepare',
  /**
   * Approve a payment batch, which releases real money.
   *
   * Separate from preparing on purpose: spec 7.4 asks for a two-person flow,
   * and the permission is only half of it — the other half is that the approver
   * must not be the submitter, which is a rule about *this* payment rather than
   * about a person, and lives in the domain.
   */
  approvePayments: 'payments:approve',
  /**
   * File a BTW-aangifte, which locks the period behind it.
   *
   * Not folded into `ledger:post`: filing is a statement to the tax authority
   * in the entity's name, and a bookkeeper posting a hundred entries a day is
   * not the person who should be making it. A bookkeeper prepares the return
   * and reads its reconciliation with `ledger:read`.
   */
  fileVat: 'vat:file',
  /**
   * Authorise a purchase invoice for payment.
   *
   * Separate from `ledger:post` because entering a cost and authorising it are
   * different acts, and the person doing a hundred of the first should not be
   * the only check on the second. Unlike a payment file this does allow
   * self-approval: the two-person control stands between the books and the
   * bank, and a one-person BV has to be able to run.
   */
  approvePurchase: 'purchase:approve',
  /**
   * Set or lift a legal hold, and delete documents whose bewaarplicht has run
   * out (spec 7.6).
   *
   * Its own permission, held by the owner alone. Deleting statutory records is
   * the one action in this system that destroys evidence — every other
   * destructive act is a reversal that leaves both sides in the journal. A
   * bookkeeper with `ledger:configure` should not be able to reach it by
   * accident, and an accountant advising on a retention question is not the
   * person who presses it.
   */
  manageRetention: 'retention:manage',
  /**
   * Create a new administration. Instance-scoped, not entity-scoped: it is held
   * by a signed-in human and by no role and no API token, because a token is
   * issued by one administration and must not be able to create another.
   */
  createEntity: 'entity:create',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export type Role = 'owner' | 'bookkeeper' | 'accountant' | 'auditor'

/**
 * Deliberate asymmetries, each one from spec 4:
 *
 * - **auditor** gets read and export and nothing else. "Never logs in, gets an
 *   export" — but when they do log in, that is all they get.
 * - **accountant** is the only role with `post-closed` and `close`. Soft close
 *   means "only the accountant may post", which is exactly this line.
 * - **bookkeeper** is the heaviest user and cannot close a year or post into a
 *   closed period. Fast entry, not final authority.
 * - **owner** can do everything including issue tokens, because somebody has to.
 */
const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: [
    PERMISSIONS.read,
    PERMISSIONS.post,
    PERMISSIONS.postClosed,
    PERMISSIONS.close,
    PERMISSIONS.configure,
    PERMISSIONS.export,
    PERMISSIONS.import,
    PERMISSIONS.manageTokens,
    PERMISSIONS.manageMembers,
    PERMISSIONS.preparePayments,
    PERMISSIONS.approvePayments,
    PERMISSIONS.fileVat,
    PERMISSIONS.approvePurchase,
    PERMISSIONS.manageRetention,
  ],
  accountant: [
    PERMISSIONS.read,
    PERMISSIONS.post,
    PERMISSIONS.postClosed,
    PERMISSIONS.close,
    PERMISSIONS.configure,
    PERMISSIONS.export,
    PERMISSIONS.import,
    PERMISSIONS.preparePayments,
    PERMISSIONS.approvePayments,
    PERMISSIONS.fileVat,
    PERMISSIONS.approvePurchase,
  ],
  /**
   * A bookkeeper prepares payments and cannot approve them. That is the
   * two-person flow's first half: the heaviest user of the system is not the
   * one who releases the money.
   */
  bookkeeper: [
    PERMISSIONS.read,
    PERMISSIONS.post,
    PERMISSIONS.configure,
    PERMISSIONS.export,
    PERMISSIONS.preparePayments,
  ],
  auditor: [PERMISSIONS.read, PERMISSIONS.export],
}

export const ROLES = Object.keys(ROLE_PERMISSIONS) as readonly Role[]

export function isRole(value: string): value is Role {
  return Object.hasOwn(ROLE_PERMISSIONS, value)
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role]
}

/**
 * Does this permission set satisfy the requirement?
 *
 * `*` is total, and `ledger:*` grants every `ledger:` permission. One level of
 * wildcard, no deeper: a permission language nobody can reason about is a
 * permission language that grants too much.
 */
export function grants(held: ReadonlySet<string>, required: string): boolean {
  if (held.has('*')) return true
  if (held.has(required)) return true
  const [scope] = required.split(':')
  return scope !== undefined && held.has(`${scope}:*`)
}
