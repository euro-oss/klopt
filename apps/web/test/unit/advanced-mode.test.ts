import { describe, expect, it } from 'vitest'
import {
  AdvancedModeValidationError,
  defaultAdvancedMode,
  parseAdvancedModeWrite,
  resolveAdvancedMode,
  retiredAdvancedModeCookieNames,
} from '../../src/lib/advanced-mode.js'

describe('Geavanceerd defaults', () => {
  it('defaults off for Eigenaar and on for bookkeeping roles', () => {
    expect(defaultAdvancedMode('owner')).toBe(false)
    expect(defaultAdvancedMode('bookkeeper')).toBe(true)
    expect(defaultAdvancedMode('accountant')).toBe(true)
    expect(defaultAdvancedMode('auditor')).toBe(true)
  })

  it('honours an explicit server preference over the role default', () => {
    expect(resolveAdvancedMode(true, 'owner')).toBe(true)
    expect(resolveAdvancedMode(false, 'bookkeeper')).toBe(false)
    expect(resolveAdvancedMode(null, 'owner')).toBe(false)
    expect(resolveAdvancedMode(null, 'accountant')).toBe(true)
    expect(resolveAdvancedMode(undefined, 'auditor')).toBe(true)
  })

  it('lists only retired Geavanceerd cookie names for clearing', () => {
    expect(
      retiredAdvancedModeCookieNames(
        'klopt_advanced=1; theme=light; klopt_advanced_user-abc=0; session=x',
      ),
    ).toEqual(['klopt_advanced', 'klopt_advanced_user-abc'])
  })
})

describe('Geavanceerd write payload', () => {
  it('accepts a boolean enabled and ignores a client-supplied userId', () => {
    // The server function takes the user id from the session only. A forged
    // userId in the body must not survive parsing into the handler payload.
    expect(parseAdvancedModeWrite({ enabled: true, userId: 'attacker-or-other-user' })).toEqual({
      enabled: true,
    })
    expect(parseAdvancedModeWrite({ enabled: false, userId: 'anyone' })).toEqual({
      enabled: false,
    })
  })

  it('rejects anything that is not a boolean enabled with status 400', () => {
    for (const bad of [
      { enabled: 'true' },
      { enabled: 1 },
      { enabled: null },
      { enabled: undefined },
      {},
      null,
      'true',
      true,
      [{ enabled: true }],
    ]) {
      try {
        parseAdvancedModeWrite(bad)
        expect.unreachable(`expected rejection for ${JSON.stringify(bad)}`)
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(AdvancedModeValidationError)
        expect((error as AdvancedModeValidationError).status).toBe(400)
        expect((error as Error).message).toBe('enabled must be a boolean')
      }
    }
  })
})
