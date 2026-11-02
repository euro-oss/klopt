/**
 * Client helpers for Exact wizard VAT preview (#100).
 */

import type { ExactVatMappingSummary } from '@klopt/core'

export function vatMappingFromPreview(
  preview: Record<string, unknown> | null,
): ExactVatMappingSummary | null {
  if (preview === null) return null
  const raw = preview['vatMapping']
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if (!Array.isArray(row['rows'])) return null
  const recognised = typeof row['recognised'] === 'number' ? row['recognised'] : 0
  const codeCount =
    typeof row['codeCount'] === 'number'
      ? row['codeCount']
      : typeof row['total'] === 'number'
        ? row['total']
        : 0
  return {
    rows: row['rows'] as ExactVatMappingSummary['rows'],
    recognised,
    codeCount,
  }
}

export function exactPreviewCounts(preview: Record<string, unknown> | null): {
  readonly accounts: number
  readonly contacts: number
  readonly openItems: number
  readonly taxCodes: number
} {
  if (preview === null) {
    return { accounts: 0, contacts: 0, openItems: 0, taxCodes: 0 }
  }
  const accounts = preview['accounts'] as { count?: number } | undefined
  const contacts = preview['contacts'] as { count?: number } | undefined
  const openItems = preview['openItems'] as
    { receivable?: { count?: number }; payable?: { count?: number } } | undefined
  const taxCodes = preview['taxCodes'] as { length?: number } | readonly unknown[] | undefined
  const taxCount = Array.isArray(taxCodes)
    ? taxCodes.length
    : typeof taxCodes === 'object' && taxCodes !== null && 'length' in taxCodes
      ? Number(taxCodes.length ?? 0)
      : 0
  return {
    accounts: accounts?.count ?? 0,
    contacts: contacts?.count ?? 0,
    openItems: (openItems?.receivable?.count ?? 0) + (openItems?.payable?.count ?? 0),
    taxCodes: taxCount,
  }
}
