import { describe, expect, it } from 'vitest'
import { PERMISSIONS, ROLES, grants, isRole, permissionsForRole } from '../../src/auth/roles.js'

/**
 * Roles are a bundle of permissions and nothing more (spec 4). These tests are
 * mostly about the asymmetries being deliberate: each one below is a line from
 * the requirements, and each would be easy to widen by accident.
 */

describe('roles', () => {
  it('covers the four users in the requirements', () => {
    expect([...ROLES].sort()).toEqual(['accountant', 'auditor', 'bookkeeper', 'owner'])
  })

  it('recognises a role, and refuses anything else', () => {
    expect(isRole('accountant')).toBe(true)
    expect(isRole('administrator')).toBe(false)
    expect(isRole('__proto__')).toBe(false)
  })

  it('gives the auditor read and export, and nothing else', () => {
    // "Never logs in, gets an export" — but when they do log in, that is all.
    expect([...permissionsForRole('auditor')].sort()).toEqual(
      [PERMISSIONS.export, PERMISSIONS.read].sort(),
    )
  })

  it('makes the accountant the only role that may post into a soft-closed period', () => {
    // Soft close means "only the accountant may post" (spec 6.4).
    const allowed = ROLES.filter((role) =>
      permissionsForRole(role).includes(PERMISSIONS.postClosed),
    )
    expect(allowed.sort()).toEqual(['accountant', 'owner'])
  })

  it('does not let a bookkeeper close a year', () => {
    // The heaviest user, but not the final authority.
    expect(permissionsForRole('bookkeeper')).not.toContain(PERMISSIONS.close)
    expect(permissionsForRole('bookkeeper')).not.toContain(PERMISSIONS.postClosed)
  })

  it('lets only the owner issue tokens', () => {
    const allowed = ROLES.filter((role) =>
      permissionsForRole(role).includes(PERMISSIONS.manageTokens),
    )
    expect(allowed).toEqual(['owner'])
  })

  it('gives every role read access, because none of them is useful without it', () => {
    for (const role of ROLES) {
      expect(permissionsForRole(role), role).toContain(PERMISSIONS.read)
    }
  })
})

describe('permission matching', () => {
  it('matches exactly', () => {
    expect(grants(new Set(['ledger:read']), 'ledger:read')).toBe(true)
    expect(grants(new Set(['ledger:read']), 'ledger:post')).toBe(false)
  })

  it('honours a total wildcard', () => {
    expect(grants(new Set(['*']), 'anything:at-all')).toBe(true)
  })

  it('honours one level of scope wildcard, and only one', () => {
    expect(grants(new Set(['ledger:*']), 'ledger:post')).toBe(true)
    // Not a prefix match: `ledger:*` must not grant `tokens:manage`.
    expect(grants(new Set(['ledger:*']), 'tokens:manage')).toBe(false)
    // And there is no deeper wildcard to reason about.
    expect(grants(new Set(['ledger:post:*']), 'ledger:post')).toBe(false)
  })

  it('refuses an empty permission set', () => {
    expect(grants(new Set(), 'ledger:read')).toBe(false)
  })
})
