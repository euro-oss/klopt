/**
 * Plain je-voice VAT labels for the Beheer Btw-codes screen.
 *
 * Reuses the keys shipped for #71 / #86 (`importFindings.vat.*` /
 * `invoiceGuided.vat.*`). Deduction halves (`*-VOOR`) share the primary half’s
 * label; PRIV21 has its own Beheer key.
 */

import type { MessageKey } from '~/i18n/nl'

/** Map a deduction half onto the primary code that already has a plain label. */
const DEDUCTION_TO_PRIMARY: Readonly<Record<string, string>> = {
  'VERL-VOOR': 'VERL-ONTV',
  'VERL9-VOOR': 'VERL9-ONTV',
  'ICV21-VOOR': 'ICV21',
  'ICV9-VOOR': 'ICV9',
  'INV23-VOOR': 'INV23',
  'INV9-VOOR': 'INV9',
}

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string

/** Resolve a plain Dutch / English label for a chart code. */
export function plainVatLabel(code: string, t: Translate, fallbackDescription?: string): string {
  if (code === 'PRIV21') {
    const key = 'taxCodes.plain.PRIV21' as MessageKey
    const translated = t(key)
    if (translated !== key) return translated
  }

  const lookup = DEDUCTION_TO_PRIMARY[code] ?? code
  for (const prefix of ['invoiceGuided.vat.', 'importFindings.vat.'] as const) {
    const key = `${prefix}${lookup}` as MessageKey
    const translated = t(key)
    if (
      translated !== undefined &&
      translated !== key &&
      !translated.startsWith('invoiceGuided.vat.') &&
      !translated.startsWith('importFindings.vat.')
    ) {
      return translated
    }
  }
  return fallbackDescription ?? code
}

/** Offer key → plain label (uses the primary / first code of the offer). */
export function plainOfferLabel(
  codes: readonly string[],
  t: Translate,
  fallbackDescription?: string,
): string {
  const primary = codes[0] ?? ''
  return plainVatLabel(primary, t, fallbackDescription)
}
