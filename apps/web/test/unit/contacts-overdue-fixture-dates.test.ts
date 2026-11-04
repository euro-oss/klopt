import { describe, expect, it } from 'vitest'
import { addCalendarDays } from '../../src/lib/amsterdam-date.js'
import {
  CONTACTS_OVERDUE_CALENDAR_PROOF_DATES,
  contactsOverdueFixtureDates,
  OVERDUE_CUSTOMER_PAYMENT_TERMS_DAYS,
} from '../../e2e/support/contacts-overdue-fixture-dates.js'

describe('contactsOverdueFixtureDates', () => {
  for (const asOf of CONTACTS_OVERDUE_CALENDAR_PROOF_DATES) {
    it(`keeps purchase issue dates in-year and overdue due before asOf on ${asOf}`, () => {
      const dates = contactsOverdueFixtureDates(asOf)
      const notYetDue = dates.notYetDuePurchaseBill()
      expect(notYetDue.invoiceDate >= dates.fiscalYearStart).toBe(true)
      expect(notYetDue.dueDate > asOf).toBe(true)

      const overdue = dates.overduePurchaseBill()
      expect(overdue.dueDate < asOf).toBe(true)
      expect(overdue.invoiceDate <= overdue.dueDate).toBe(true)
    })

    it(`customer overdue issue yields due before asOf on ${asOf}`, () => {
      const dates = contactsOverdueFixtureDates(asOf)
      if (asOf === dates.fiscalYearStart) return
      const issue = dates.customerOverdueIssueDate()
      expect(addCalendarDays(issue, OVERDUE_CUSTOMER_PAYMENT_TERMS_DAYS) < asOf).toBe(true)
      expect(issue >= dates.fiscalYearStart).toBe(true)
    })
  }
})
