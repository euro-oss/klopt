import { describe, expect, it } from 'vitest'
import {
  deliveryCalendarDateFromInstant,
  shortDeliveryDate,
} from '../../src/lib/delivery-display.js'

const t = (key: string) => key

describe('delivery calendar dates (#121)', () => {
  it('maps 2026-10-30T23:30:00Z to 31 October in Amsterdam', () => {
    expect(deliveryCalendarDateFromInstant('2026-10-30T23:30:00.000Z')).toBe('2026-10-31')
  })

  it('maps 2026-07-14T22:30:00Z to 15 July in Amsterdam', () => {
    expect(deliveryCalendarDateFromInstant('2026-07-14T22:30:00.000Z')).toBe('2026-07-15')
  })

  it('shortDeliveryDate uses the Amsterdam calendar day', () => {
    expect(shortDeliveryDate('2026-10-30T23:30:00.000Z', t)).toBe('31 dash.month.10')
  })
})
