/**
 * Verzonden delivery timestamps as Amsterdam calendar dates (#121).
 */

import { calendarDateInTimeZone } from './amsterdam-date'
import type { MessageKey } from '~/i18n/nl'

const AMSTERDAM = 'Europe/Amsterdam'

export function deliveryCalendarDateFromInstant(iso: string): string {
  return calendarDateInTimeZone(new Date(iso), AMSTERDAM)
}

export function shortDeliveryDate(iso: string, t: (key: MessageKey) => string): string {
  const calendar = deliveryCalendarDateFromInstant(iso)
  const day = String(Number(calendar.slice(8, 10)))
  const month = Number(calendar.slice(5, 7))
  const monthKey = `dash.month.${String(month)}` as MessageKey
  return `${day} ${t(monthKey)}`
}
