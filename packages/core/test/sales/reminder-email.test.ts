import { describe, expect, it } from 'vitest'
import { reminderEmailCopy } from '../../src/sales/reminder-email.js'

describe('reminderEmailCopy', () => {
  it('does not mention collection costs or statutory interest', () => {
    for (const stage of [1, 2, 3]) {
      const text = reminderEmailCopy({
        invoiceNumber: '2026-0001',
        total: '10,00',
        currency: 'EUR',
        dueDate: '2026-01-01',
        stage,
        daysOverdue: 50,
      }).text
      expect(text).not.toMatch(/incasso|rente/i)
    }
  })
})
