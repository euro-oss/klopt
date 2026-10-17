import { afterEach, describe, expect, it } from 'vitest'
import {
  isInstanceAdmin,
  isSignupClosed,
  mayCreateEntity,
  parseInstanceAdmins,
} from '../src/api/instance-access.js'

describe('parseInstanceAdmins', () => {
  it('trims, lower-cases and drops empties', () => {
    expect([...parseInstanceAdmins('  Ada@Example.NL , , bob@voorbeeld.nl ')]).toEqual([
      'ada@example.nl',
      'bob@voorbeeld.nl',
    ])
  })

  it('is empty when unset or blank — fail closed with signup closed', () => {
    expect(parseInstanceAdmins(undefined).size).toBe(0)
    expect(parseInstanceAdmins('').size).toBe(0)
    expect(parseInstanceAdmins('   ').size).toBe(0)
  })
})

describe('mayCreateEntity', () => {
  afterEach(() => {
    delete process.env['KLOPT_SIGNUP']
    delete process.env['KLOPT_INSTANCE_ADMINS']
  })

  it('allows every address when signup is open', () => {
    expect(isSignupClosed({})).toBe(false)
    expect(mayCreateEntity('anyone@example.nl', {})).toBe(true)
  })

  it('allows only listed instance admins when closed', () => {
    const env = {
      KLOPT_SIGNUP: 'closed',
      KLOPT_INSTANCE_ADMINS: 'Beheerder@Voorbeeld.NL',
    }
    expect(isSignupClosed(env)).toBe(true)
    expect(isInstanceAdmin('beheerder@voorbeeld.nl', env)).toBe(true)
    expect(mayCreateEntity('beheerder@voorbeeld.nl', env)).toBe(true)
    expect(mayCreateEntity('eigenaar@andere.nl', env)).toBe(false)
  })

  it('refuses everyone when closed and the admin list is empty', () => {
    const env = { KLOPT_SIGNUP: 'closed' }
    expect(mayCreateEntity('anyone@example.nl', env)).toBe(false)
  })
})
