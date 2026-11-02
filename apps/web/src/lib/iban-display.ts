/**
 * Display helpers for IBANs on Costs / PaymentBatch (#128).
 *
 * Fixtures and placeholders use the registry example only:
 * NL91 ABNA 0417 1643 00.
 */

/** Compact IBAN → groups of four for display. */
export function formatIbanGroups(iban: string): string {
  const compact = iban.replace(/\s/g, '').toUpperCase()
  if (compact === '') return ''
  return compact.replace(/(.{4})/g, '$1 ').trim()
}

/** Last four of an IBAN for “··· 4300” account labels. */
export function ibanTail(iban: string): string {
  const compact = iban.replace(/\s/g, '').toUpperCase()
  return compact.length <= 4 ? compact : compact.slice(-4)
}
