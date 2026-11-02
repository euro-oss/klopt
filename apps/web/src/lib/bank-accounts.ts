/**
 * Display helpers for Bank · Accounts and statements (#129 / BankAccounts board).
 * Kept separate from Match helpers so Bank Match (#164) can land without conflict.
 */

/** Group an IBAN for display: `NL91ABNA0417164300` → `NL91 ABNA 0417 1643 00`. */
export function formatIbanDisplay(iban: string): string {
  const compact = iban.replace(/\s+/g, '').toUpperCase()
  return compact.replace(/(.{4})/g, '$1 ').trim()
}

/** Short day+month for transaction rows (`12 Dec`), locale-neutral English abbr. */
export function formatBankDayMonth(iso: string): string {
  const [, month, day] = iso.split('-')
  if (month === undefined || day === undefined) return iso
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ] as const
  const index = Number(month) - 1
  const label = months[index]
  if (label === undefined) return iso
  return `${Number(day)} ${label}`
}
