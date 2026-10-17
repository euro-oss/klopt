import { describe, expect, it } from 'vitest'
import { defaultAdvancedMode, resolveAdvancedMode } from '../../src/lib/advanced-mode.js'

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
})
