import { describe, expect, it } from 'vitest'
import {
  advancedModeCookieName,
  defaultAdvancedMode,
  resolveAdvancedMode,
} from '../../src/lib/advanced-mode.js'

describe('Geavanceerd defaults', () => {
  it('defaults off for Eigenaar and on for bookkeeping roles', () => {
    expect(defaultAdvancedMode('owner')).toBe(false)
    expect(defaultAdvancedMode('bookkeeper')).toBe(true)
    expect(defaultAdvancedMode('accountant')).toBe(true)
    expect(defaultAdvancedMode('auditor')).toBe(true)
  })

  it('honours a remembered cookie over the role default', () => {
    expect(resolveAdvancedMode('1', 'owner')).toBe(true)
    expect(resolveAdvancedMode('0', 'bookkeeper')).toBe(false)
    expect(resolveAdvancedMode(null, 'owner')).toBe(false)
    expect(resolveAdvancedMode(null, 'accountant')).toBe(true)
  })

  it('scopes the cookie name to the user id', () => {
    expect(advancedModeCookieName('user-abc')).toBe('klopt_advanced_user-abc')
    expect(advancedModeCookieName('a/b@c')).toBe('klopt_advanced_a_b_c')
  })
})
