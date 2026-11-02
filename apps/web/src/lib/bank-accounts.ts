/**
 * Display helpers for Bank · Accounts and statements (#129 / BankAccounts board).
 * Kept separate from Match helpers so Bank Match (#164) can land without conflict.
 */

/** Group an IBAN for display: `NL91ABNA0417164300` → `NL91 ABNA 0417 1643 00`. */
export function formatIbanDisplay(iban: string): string {
  const compact = iban.replace(/\s+/g, '').toUpperCase()
  return compact.replace(/(.{4})/g, '$1 ').trim()
}

/**
 * Short day+month for transaction rows (`12 okt` / `12 Oct`), locale-aware via
 * `Intl`. Falls back to the ISO date when parsing fails.
 */
export function formatBankDayMonth(iso: string, locale: string = 'en-GB'): string {
  const [year, month, day] = iso.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return iso
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return iso
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}
