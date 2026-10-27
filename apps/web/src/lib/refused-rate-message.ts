/**
 * Legal refused-rate copy with filled placeholders (#105).
 */

import type { MessageKey } from '~/i18n/nl'

export function ratePctLabel(percentage: string): string {
  const trimmed = percentage.trim().replace(/%$/u, '')
  return trimmed === '' ? '—' : `${trimmed}%`
}

export function codePctLabel(
  code: string,
  rules: readonly { readonly code: string; readonly rateBasisPoints: number }[],
): string {
  const rule = rules.find((row) => row.code === code)
  if (rule === undefined) return '—'
  const pct = rule.rateBasisPoints / 100
  return `${Number.isInteger(pct) ? String(pct) : pct.toFixed(2)}%`
}

export function refusedRateMessage(
  rate: { readonly percentage: string },
  violation: { readonly rejected: string; readonly message: string },
  t: (key: MessageKey, values?: Record<string, string>) => string,
  rules: readonly { readonly code: string; readonly rateBasisPoints: number }[],
): string {
  const code = violation.rejected.trim()
  if (code === '') return violation.message
  return t('wizard.btw.refusedRate', {
    code,
    ratePct: ratePctLabel(rate.percentage),
    codePct: codePctLabel(code, rules),
  })
}
