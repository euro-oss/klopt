import { describe, expect, it } from 'vitest'
import { reminderEmailCopy } from '@klopt/core'

/**
 * Reminders email preview must mirror the transport template (#107 Phase 2).
 * Legal: no collection costs / statutory interest wording until WIK exists.
 */

describe('reminderEmailCopy (Reminders read-only preview)', () => {
  it('stage 1 is a courtesy without costs or interest', () => {
    const copy = reminderEmailCopy({
      invoiceNumber: '2026-0040',
      total: '711,04',
      currency: 'EUR',
      dueDate: '2026-01-01',
      stage: 1,
      daysOverdue: 10,
    })
    expect(copy.subject).toBe('Betalingsherinnering: factuur 2026-0040')
    expect(copy.text).toContain('nog niet als betaald')
    expect(copy.text).not.toMatch(/incasso|rente/i)
  })

  it('stage 3 asks for payment within fourteen days without WIK threats', () => {
    const copy = reminderEmailCopy({
      invoiceNumber: '2026-0037',
      total: '985,93',
      currency: 'EUR',
      dueDate: '2025-02-10',
      stage: 3,
      daysOverdue: 324,
    })
    expect(copy.subject).toBe('Laatste aanmaning: factuur 2026-0037')
    expect(copy.text).toContain('324 dagen te laat')
    expect(copy.text).toContain('veertien dagen')
    expect(copy.text).not.toMatch(/incassokosten|wettelijke\s+rente|incasso/i)
  })

  it('is the same Dutch text the transport would send', () => {
    // Stable snapshot for Legal / Design: preview must not invent board copy.
    const copy = reminderEmailCopy({
      invoiceNumber: '2026-0001',
      total: '100,00',
      currency: 'EUR',
      dueDate: '2026-01-15',
      stage: 2,
      daysOverdue: 21,
    })
    expect(copy.text).toBe(
      [
        'Factuur 2026-0001 van 100,00 EUR is nu',
        '21 dagen te laat. Wij hebben u hierover eerder bericht.',
        '',
        'Wij verzoeken u het bedrag binnen veertien dagen te voldoen.',
        '',
        'De factuur is bijgevoegd.',
      ].join('\n'),
    )
  })
})
