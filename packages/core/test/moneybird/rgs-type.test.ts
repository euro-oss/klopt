import { describe, expect, it } from 'vitest'
import { inferAccountTypeFromRgs } from '../../src/moneybird/resources.js'

describe('inferAccountTypeFromRgs', () => {
  it('maps revenue and other operating/investment income leads as revenue', () => {
    expect(inferAccountTypeFromRgs('WOmz')).toBe('revenue')
    expect(inferAccountTypeFromRgs('WOmzDi')).toBe('revenue')
    expect(inferAccountTypeFromRgs('WOvb')).toBe('revenue')
    expect(inferAccountTypeFromRgs('WOvbDi')).toBe('revenue')
    expect(inferAccountTypeFromRgs('WOvt')).toBe('revenue')
  })

  it('maps WFbe by sub-code: Rlm revenue, Rls/Orl expense, bare/unknown null', () => {
    expect(inferAccountTypeFromRgs('WFbeRlm')).toBe('revenue')
    expect(inferAccountTypeFromRgs('WFbeRlmObr')).toBe('revenue')
    expect(inferAccountTypeFromRgs('WFbeRls')).toBe('expense')
    expect(inferAccountTypeFromRgs('WFbeRlsRhl')).toBe('expense')
    expect(inferAccountTypeFromRgs('WFbeOrl')).toBe('expense')
    expect(inferAccountTypeFromRgs('WFbeOrlRkb')).toBe('expense')
    // Parent and unknown children: no suggestion (interest expense must not look like revenue).
    expect(inferAccountTypeFromRgs('WFbe')).toBeNull()
    expect(inferAccountTypeFromRgs('WFbeWis')).toBeNull()
    expect(inferAccountTypeFromRgs('WFbeKba')).toBeNull()
  })

  it('maps cost leads as expense', () => {
    expect(inferAccountTypeFromRgs('WKpr')).toBe('expense')
    expect(inferAccountTypeFromRgs('WBed')).toBe('expense')
    expect(inferAccountTypeFromRgs('WPer')).toBe('expense')
    expect(inferAccountTypeFromRgs('WAfs')).toBe('expense')
  })

  it('maps BLas (long-term debt) and other liability leads as liability', () => {
    expect(inferAccountTypeFromRgs('BLas')).toBe('liability')
    expect(inferAccountTypeFromRgs('BLasAcl')).toBe('liability')
    expect(inferAccountTypeFromRgs('BSch')).toBe('liability')
    expect(inferAccountTypeFromRgs('BVrz')).toBe('liability')
  })

  it('maps equity and asset leads', () => {
    expect(inferAccountTypeFromRgs('BEiv')).toBe('equity')
    expect(inferAccountTypeFromRgs('BVorDeb')).toBe('asset')
  })

  it('returns null for empty input', () => {
    expect(inferAccountTypeFromRgs(null)).toBeNull()
    expect(inferAccountTypeFromRgs(undefined)).toBeNull()
    expect(inferAccountTypeFromRgs('')).toBeNull()
  })
})
