import { describe, expect, it } from 'vitest'
import {
  defaultAdvancedMode,
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
