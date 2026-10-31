import { describe, expect, it } from 'vitest'
import { reminderEmailCopy } from '../../src/sales/reminder-email.js'

describe('reminderEmailCopy', () => {
  it('does not mention collection costs, interest, or a 14-day deadline', () => {
    for (const stage of [1, 2, 3]) {
      const copy = reminderEmailCopy({
        invoiceNumber: '2026-0001',
        total: '10,00',
        currency: 'EUR',
        dueDate: '2026-01-01',
        stage,
        daysOverdue: 50,
      })
      expect(copy.text).not.toMatch(/incasso|rente|veertien|buitengerechtelijk|6:96/i)
    }
  })

  it('uses Legal stage 2 and 3 wording and Derde herinnering for stage 3', () => {
    const stage2 = reminderEmailCopy({
      invoiceNumber: '2026-0001',
      total: '10,00',
      currency: 'EUR',
      dueDate: '2026-01-01',
      stage: 2,
      daysOverdue: 25,
    })
    expect(stage2.subject).toBe('Tweede herinnering: factuur 2026-0001')
    expect(stage2.text).toContain(
      'Wij verzoeken u het openstaande bedrag zo spoedig mogelijk te voldoen.',
    )
    expect(stage2.text).toContain(
      'Heeft u inmiddels betaald, dan kunt u dit bericht als niet verzonden beschouwen.',
    )

    const stage3 = reminderEmailCopy({
      invoiceNumber: '2026-0001',
      total: '10,00',
      currency: 'EUR',
      dueDate: '2026-01-01',
      stage: 3,
      daysOverdue: 50,
    })
    expect(stage3.subject).toBe('Derde herinnering: factuur 2026-0001')
    expect(stage3.text).toContain(
      'Wij verzoeken u het openstaande bedrag zo spoedig mogelijk te voldoen.',
    )
    expect(stage3.text).toContain('Heeft u vragen over deze factuur, neem dan contact met ons op.')
  })
})
