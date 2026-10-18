import { describe, expect, it } from 'vitest'
import { inferAccountTypeFromRgs } from '../../src/moneybird/resources.js'

describe('inferAccountTypeFromRgs', () => {
  it('maps revenue and other/financial income leads as revenue', () => {
    expect(inferAccountTypeFromRgs('WOmz')).toBe('revenue')
    expect(inferAccountTypeFromRgs('WOmzDi')).toBe('revenue')
    expect(inferAccountTypeFromRgs('WOvb')).toBe('revenue')
    expect(inferAccountTypeFromRgs('WOvbDi')).toBe('revenue')
    expect(inferAccountTypeFromRgs('WOvt')).toBe('revenue')
    expect(inferAccountTypeFromRgs('WFbe')).toBe('revenue')
    expect(inferAccountTypeFromRgs('WFbeBa')).toBe('revenue')
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
