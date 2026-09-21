import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { permissionsForRole, ROLES, type Permission } from '@klopt/core'
import {
  may,
  MAY_CLOSE_YEAR,
  MAY_EXPORT_AUDIT_FILE,
  MAY_IMPORT_AUDIT_FILE,
  MAY_OPEN_YEAR,
} from '../../src/lib/roles.js'

/**
 * The roles a screen offers an action to, held to the roles that may take it.
 *
 * `~/lib/roles` is a copy: the permissions live in `@klopt/core`, which cannot
 * reach a browser, so the UI writes down which roles hold each one. A copy that
 * drifts is a screen printing a button whose only outcome is 403 — or, worse, one
 * hiding a capability from the role that has it, which is how #6's own
 * motivation ("a bookkeeper whose year rolled over cannot post into the new
 * year") gets reintroduced by a nav gate.
 *
 * So the lists are not reviewed, they are checked: every one of them is compared
 * against the roles that actually hold the permission behind it.
 */

const holdersOf = (permission: Permission): readonly string[] =>
  ROLES.filter((role) => permissionsForRole(role).includes(permission)).toSorted()

const sorted = (roles: readonly string[]): readonly string[] => [...roles].toSorted()

describe('the roles a screen offers an action to', () => {
  it('are the roles that hold the permission behind it', () => {
    expect(sorted(MAY_CLOSE_YEAR)).toEqual(holdersOf('ledger:close'))
    expect(sorted(MAY_OPEN_YEAR)).toEqual(holdersOf('ledger:configure'))
    expect(sorted(MAY_IMPORT_AUDIT_FILE)).toEqual(holdersOf('ledger:import'))
    expect(sorted(MAY_EXPORT_AUDIT_FILE)).toEqual(holdersOf('ledger:export'))
  })

  it('separate opening a year from closing one, because the permissions do', () => {
    // The whole reason /fiscal-years cannot be gated as one screen: the
    // bookkeeper may open next year and may not close this one.
    expect(may(MAY_OPEN_YEAR, 'bookkeeper')).toBe(true)
    expect(may(MAY_CLOSE_YEAR, 'bookkeeper')).toBe(false)
  })

  it('let the auditor take the books away and not write them back', () => {
    expect(may(MAY_EXPORT_AUDIT_FILE, 'auditor')).toBe(true)
    expect(may(MAY_IMPORT_AUDIT_FILE, 'auditor')).toBe(false)
  })

  it('say nothing about a role that does not exist', () => {
    expect(may(MAY_CLOSE_YEAR, '')).toBe(false)
    expect(may(MAY_CLOSE_YEAR, 'boekhouder')).toBe(false)
  })
})

describe('the navigation', () => {
  const shell = readFileSync(
    join(import.meta.dirname, '..', '..', 'src', 'components', 'app-shell.tsx'),
    'utf8',
  )

  /**
   * The sidebar reads the lists rather than repeating them.
   *
   * Asserted on the source because that is where the mistake would be: a nav
   * entry with `roles: ['owner', 'accountant']` spelled out beside a screen that
   * checks `MAY_OPEN_YEAR` is two answers to one question, and the one the
   * reader meets first is the nav's.
   */
  it('gates the Alpha 3 screens on the same lists the screens do', () => {
    expect(shell).toContain('MAY_OPEN_YEAR')
    expect(shell).toContain('MAY_EXPORT_AUDIT_FILE')
    expect(shell).not.toMatch(/to: '\/fiscal-years',[\s\S]{0,200}roles: \[/)
    expect(shell).not.toMatch(/to: '\/audit-file',[\s\S]{0,200}roles: \[/)
  })
})
