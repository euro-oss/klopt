import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultImporterenWizardYear,
  defaultManualEntryBookingDate,
} from '../../src/lib/booking-defaults.js'
import { xafExportGeneratedOn } from '../../src/lib/document-generated-on.js'

/** 2027-01-01 00:30 Amsterdam while UTC is still 2026-12-31 (#121). */
const NEW_YEAR_AMSTERDAM = new Date('2026-12-31T23:30:00.000Z')

describe('PM call-site tests at New Year midnight (#121)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NEW_YEAR_AMSTERDAM)
    delete process.env['KLOPT_E2E_TODAY_ISO']
    delete process.env['KLOPT_E2E_LEGAL_TOGGLE']
    process.env['NODE_ENV'] = 'test'
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
  })

  it('journal entry default booking date', () => {
    expect(defaultManualEntryBookingDate()).toBe('2027-01-01')
  })

  it('credit note default issue date', async () => {
    const { defaultCreditNoteIssueDate } = await import('../../src/lib/booking-defaults.js')
    expect(defaultCreditNoteIssueDate()).toBe('2027-01-01')
  })

  it('XAF export generatedOn is the Amsterdam calendar date', () => {
    expect(xafExportGeneratedOn()).toBe('2027-01-01')
  })

  it('importeren wizard default year without overrides', () => {
    expect(defaultImporterenWizardYear(undefined, undefined)).toBe('2027')
  })

  it('importeren wizard year keeps explicit selected or report year', () => {
    expect(defaultImporterenWizardYear('2025', undefined)).toBe('2025')
    expect(defaultImporterenWizardYear(undefined, '2024')).toBe('2024')
    expect(defaultImporterenWizardYear('2025', '2024')).toBe('2025')
  })
})
