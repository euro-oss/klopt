/**
 * Tax codes offered on new sales / purchase booking forms.
 *
 * Historical correction rates (L6, H19, VL6, VH19) stay on the chart for
 * Moneybird import mapping and late corrections, but must never appear when
 * booking a new invoice today. PRIV21 is private use, not a sales-line choice.
 */

export const SALES_BOOKING_EXCLUDED = new Set(['PRIV21', 'L6', 'H19'])

export const PURCHASE_BOOKING_EXCLUDED = new Set(['VL6', 'VH19'])

export function salesBookingTaxCodes<T extends { code: string; direction: string }>(
  codes: readonly T[],
): T[] {
  return codes.filter(
    (code) => code.direction === 'output' && !SALES_BOOKING_EXCLUDED.has(code.code),
  )
}

export function purchaseBookingTaxCodes<T extends { code: string; direction: string }>(
  codes: readonly T[],
): T[] {
  return codes.filter(
    (code) => code.direction === 'input' && !PURCHASE_BOOKING_EXCLUDED.has(code.code),
  )
}
