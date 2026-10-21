/**
 * Tax codes offered on new sales / purchase booking forms.
 *
 * Historical correction rates (L6, H19, VL6, VH19) stay on the chart for
 * Moneybird import mapping and late corrections, but must never appear when
 * booking a new invoice today. PRIV21 is private use, not a sales-line choice.
 *
 * Pickers also respect `validFrom` / `validTo` for the booking or document
 * date: an ended code must not stay selectable, and when the usual default
 * (H21 / VH21) is ended we preselect nothing — never another rate.
 */

export const SALES_BOOKING_EXCLUDED = new Set(['PRIV21', 'L6', 'H19'])

export const PURCHASE_BOOKING_EXCLUDED = new Set(['VL6', 'VH19'])

export type TaxCodeValidity = {
  readonly validFrom?: string
  readonly validTo?: string | null
}

/** True when the code’s window covers `onDate` (inclusive of validTo). */
export function taxCodeValidOn(code: TaxCodeValidity, onDate: string): boolean {
  if (code.validFrom !== undefined && code.validFrom !== '' && code.validFrom > onDate) {
    return false
  }
  if (code.validTo !== null && code.validTo !== undefined && code.validTo < onDate) {
    return false
  }
  return true
}

export function salesBookingTaxCodes<
  T extends { code: string; direction: string } & TaxCodeValidity,
>(codes: readonly T[], onDate?: string): T[] {
  return codes.filter(
    (code) =>
      code.direction === 'output' &&
      !SALES_BOOKING_EXCLUDED.has(code.code) &&
      (onDate === undefined || taxCodeValidOn(code, onDate)),
  )
}

export function purchaseBookingTaxCodes<
  T extends { code: string; direction: string } & TaxCodeValidity,
>(codes: readonly T[], onDate?: string): T[] {
  return codes.filter(
    (code) =>
      code.direction === 'input' &&
      !PURCHASE_BOOKING_EXCLUDED.has(code.code) &&
      (onDate === undefined || taxCodeValidOn(code, onDate)),
  )
}

/**
 * Usual sales default: H21 when still valid among the picker codes.
 * Never falls back to L9 or another rate when H21 has ended.
 */
export function defaultSalesBookingTaxCode(codes: readonly { readonly code: string }[]): string {
  return codes.some((code) => code.code === 'H21') ? 'H21' : ''
}

/**
 * Usual purchase default: VH21 when still valid among the picker codes.
 * Never falls back to VL9 / VGEEN when VH21 has ended.
 */
export function defaultPurchaseBookingTaxCode(codes: readonly { readonly code: string }[]): string {
  return codes.some((code) => code.code === 'VH21') ? 'VH21' : ''
}
