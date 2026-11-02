import { describe, expect, it } from 'vitest'
import {
  IMPORT_RAIL_STEP_COUNT,
  IMPORT_WIZARD_STEPS,
  canAdvanceFromAdministratie,
  canAdvanceFromBron,
  canAdvanceFromBtw,
  canAdvanceFromProblemen,
  canAdvanceFromVerbinden,
  canAdvanceFromVoorbeeld,
  excludedYearsFromSelection,
  isImportWizardStep,
  isTerminalStep,
  nextStep,
  prevStep,
  railEntryStep,
  railIndex,
  stepIndex,
} from '../../src/lib/import-wizard.js'

describe('import wizard steps (#100)', () => {
  it('lists the ten prototype steps in order', () => {
    expect(IMPORT_WIZARD_STEPS).toEqual([
      'bron',
      'verbinden',
      'administratie',
      'voorbeeld',
      'btw',
      'rekeningen',
      'problemen',
      'overzicht',
      'importeren',
      'klaar',
    ])
  })

  it('walks next/prev without inventing steps', () => {
    expect(nextStep('bron')).toBe('verbinden')
    expect(prevStep('bron')).toBeNull()
    expect(nextStep('klaar')).toBeNull()
    expect(prevStep('klaar')).toBe('importeren')
    expect(stepIndex('btw')).toBe(4)
  })

  it('recognises step ids and terminal steps', () => {
    expect(isImportWizardStep('btw')).toBe(true)
    expect(isImportWizardStep('nope')).toBe(false)
    expect(isTerminalStep('importeren')).toBe(true)
    expect(isTerminalStep('overzicht')).toBe(false)
  })

  it('gates advance with pure helpers', () => {
    expect(canAdvanceFromBron(null)).toBe(false)
    expect(canAdvanceFromBron('exact')).toBe(false)
    expect(canAdvanceFromBron('xaf')).toBe(false)
    expect(canAdvanceFromBron('moneybird')).toBe(true)
    expect(canAdvanceFromVerbinden(false)).toBe(false)
    expect(canAdvanceFromVerbinden(true)).toBe(true)
    expect(canAdvanceFromAdministratie({ administrationId: null, selectedYears: ['2026'] })).toBe(
      false,
    )
    expect(canAdvanceFromAdministratie({ administrationId: '1', selectedYears: ['2026'] })).toBe(
      true,
    )
    expect(canAdvanceFromVoorbeeld(false)).toBe(false)
    expect(canAdvanceFromVoorbeeld(true)).toBe(true)
    expect(
      canAdvanceFromBtw({
        usedRates: [
          { moneybirdId: 'a', mapped: true },
          { moneybirdId: 'b', mapped: false },
        ],
        excludedRateIds: new Set(['b']),
      }),
    ).toBe(true)
    expect(
      canAdvanceFromBtw({
        usedRates: [{ moneybirdId: 'b', mapped: false }],
        excludedRateIds: new Set(),
      }),
    ).toBe(false)
    expect(canAdvanceFromProblemen(2)).toBe(false)
    expect(canAdvanceFromProblemen(0)).toBe(true)
  })

  it('groups the ten steps onto the six-step rail (#134)', () => {
    expect(IMPORT_RAIL_STEP_COUNT).toBe(6)
    expect(railIndex('bron')).toBe(0)
    expect(railIndex('verbinden')).toBe(1)
    expect(railIndex('administratie')).toBe(2)
    expect(railIndex('voorbeeld')).toBe(3)
    expect(railIndex('btw')).toBe(4)
    expect(railIndex('rekeningen')).toBe(4)
    expect(railIndex('problemen')).toBe(4)
    expect(railIndex('overzicht')).toBe(5)
    expect(railIndex('importeren')).toBe(5)
    expect(railIndex('klaar')).toBe(5)
    expect(railEntryStep(2)).toBe('administratie')
    expect(railEntryStep(4)).toBe('btw')
    expect(railEntryStep(5)).toBe('overzicht')
    expect(railEntryStep(6)).toBeNull()
  })

  it('computes excluded years from selection', () => {
    expect(excludedYearsFromSelection(['2024', '2025', '2026'], ['2026'])).toEqual(['2024', '2025'])
  })
})
