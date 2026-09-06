import { describe, expect, it } from 'vitest'
import { LedgerError } from '../../src/errors.js'
import {
  assertKeepsAnOwner,
  invitationExpiry,
  normaliseEmail,
  requireEmail,
  requireRole,
  wouldOrphanEntity,
  type Member,
} from '../../src/auth/membership.js'

/**
 * The safety property: an administration always has at least one owner.
 *
 * Owner is the only role that can manage membership, so losing the last one
 * leaves books nobody can administer and no route back that does not involve
 * SQL. Both removal and demotion can cause it, which is why the check takes
 * "the role they would end up with" rather than an operation name.
 */

const members = (...roles: [string, Member['role']][]): Member[] =>
  roles.map(([userId, role]) => ({ userId, role }))

describe('keeping an owner', () => {
  const two = members(['a', 'owner'], ['b', 'owner'], ['c', 'bookkeeper'])
  const one = members(['a', 'owner'], ['b', 'bookkeeper'])

  it('lets one of two owners go', () => {
    expect(wouldOrphanEntity(two, 'a', null)).toBe(false)
    expect(() => {
      assertKeepsAnOwner(two, 'a', null)
    }).not.toThrow()
  })

  it('refuses to remove the last owner', () => {
    expect(wouldOrphanEntity(one, 'a', null)).toBe(true)
    expect(() => {
      assertKeepsAnOwner(one, 'a', null)
    }).toThrow(LedgerError)
  })

  it('refuses to demote the last owner, which removal is not the only way to do', () => {
    expect(wouldOrphanEntity(one, 'a', 'accountant')).toBe(true)
    expect(() => {
      assertKeepsAnOwner(one, 'a', 'accountant')
    }).toThrow(/last owner/)
  })

  it('lets the last owner be re-set to owner, which changes nothing', () => {
    expect(wouldOrphanEntity(one, 'a', 'owner')).toBe(false)
  })

  it('does not care what happens to anybody who is not the last owner', () => {
    expect(wouldOrphanEntity(one, 'b', null)).toBe(false)
    expect(wouldOrphanEntity(two, 'c', null)).toBe(false)
  })

  it('names the field that is at fault, which differs by operation', () => {
    const paths: (string | null)[] = []
    for (const next of [null, 'auditor'] as const) {
      try {
        assertKeepsAnOwner(one, 'a', next)
      } catch (error: unknown) {
        if (!(error instanceof LedgerError)) throw error
        paths.push(error.violations[0]?.path ?? null)
      }
    }
    expect(paths).toEqual(['userId', 'role'])
  })
})

describe('addresses', () => {
  it('compares lower-cased and trimmed, because no mail provider does otherwise', () => {
    expect(normaliseEmail('  Jan@Example.COM ')).toBe('jan@example.com')
    expect(requireEmail('Jan@Example.com')).toBe('jan@example.com')
  })

  it('refuses something that is plainly not an address', () => {
    for (const bad of ['', 'jan', 'jan@', '@example.com', 'jan@example', 'a b@example.com']) {
      expect(() => requireEmail(bad), bad).toThrow(LedgerError)
    }
  })

  it('accepts the awkward ones that are nonetheless real', () => {
    for (const good of ["o'brien+klopt@sub.example.co.uk", 'a@b.co', 'très@example.nl']) {
      expect(requireEmail(good), good).toBe(good.toLowerCase())
    }
  })
})

describe('roles', () => {
  it('accepts the four and nothing else', () => {
    for (const role of ['owner', 'bookkeeper', 'accountant', 'auditor']) {
      expect(requireRole(role)).toBe(role)
    }
    expect(() => requireRole('admin')).toThrow(LedgerError)
    expect(() => requireRole('OWNER')).toThrow(LedgerError)
  })
})

describe('invitation expiry', () => {
  it('is two weeks out', () => {
    const now = new Date('2026-09-06T12:00:00Z')
    expect(invitationExpiry(now).toISOString()).toBe('2026-09-20T12:00:00.000Z')
  })
})
