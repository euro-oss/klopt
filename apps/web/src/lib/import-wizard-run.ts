/**
 * Pure helpers for Moneybird import wizard run status (#105 PM/Legal).
 *
 * Distinguishes a true empty failure (`failed`) from a post-commit stop
 * (`failedPartial`) using booked counts on the run report.
 */

export type ImportRunState = 'pending' | 'running' | 'paused' | 'done' | 'failed'

export interface ImportRunReportView {
  readonly imported?: boolean
  readonly entriesPosted?: number | null
  readonly invoicesImported?: number | null
  readonly entriesReplayed?: number | null
  readonly entriesSkipped?: number | null
  readonly bankTransactionsCreated?: number | null
  readonly problems?: readonly { readonly code: string }[]
  readonly warnings?: readonly { readonly code: string }[]
  readonly excluded?: readonly string[]
  readonly notImported?: readonly string[]
}

export interface ImportRunStatusView {
  readonly requested?: boolean
  readonly state?: ImportRunState | string
  readonly workerSilent?: boolean
  readonly report?: ImportRunReportView | null
  readonly lastError?: string | null
}

/** Entries/documents the worker actually booked (post-commit or done). */
export function bookedCountFromReport(report: ImportRunReportView | null | undefined): number {
  if (report === null || report === undefined) return 0
  const posted = report.entriesPosted ?? 0
  const invoices = report.invoicesImported ?? 0
  const replayed = report.entriesReplayed ?? 0
  const bank = report.bankTransactionsCreated ?? 0
  return Math.max(posted, 0) + Math.max(invoices, 0) + Math.max(replayed, 0) + Math.max(bank, 0)
}

/**
 * Document count for Klaar summary: prefer posted/invoice totals from the
 * finished run, not the preview transfer count.
 */
export function klaarTransferCount(report: ImportRunReportView | null | undefined): number {
  if (report === null || report === undefined) return 0
  if (typeof report.invoicesImported === 'number' && report.invoicesImported >= 0) {
    return report.invoicesImported
  }
  if (typeof report.entriesPosted === 'number' && report.entriesPosted >= 0) {
    return report.entriesPosted
  }
  return 0
}

export type ImportFailureKind = 'none' | 'failed' | 'failedPartial'

/** Legal: `failed` only when the run proves zero entries were booked. */
export function importFailureKind(
  status: ImportRunStatusView | null | undefined,
): ImportFailureKind {
  if (status === null || status === undefined) return 'none'
  if (status.state !== 'failed') return 'none'
  return bookedCountFromReport(status.report) > 0 ? 'failedPartial' : 'failed'
}

export function isImportRunDone(status: ImportRunStatusView | null | undefined): boolean {
  return status?.state === 'done'
}

/** Soft progress for the bar — never 100 until `done`. */
export function importProgressPercent(
  status: ImportRunStatusView | null | undefined,
  enqueueAcked: boolean,
): number {
  if (status?.state === 'done') return 100
  if (status?.state === 'failed') return 0
  if (status?.state === 'running') return 55
  if (status?.state === 'pending' || status?.state === 'paused') return 20
  if (enqueueAcked) return 12
  return 0
}

export function klaarFilingBlocked(args: {
  readonly problems: readonly { readonly code: string }[]
  readonly warnings: readonly { readonly code: string }[]
}): { readonly blocked: boolean; readonly showDeadline: boolean } {
  const codes = new Set([
    ...args.problems.map((row) => row.code),
    ...args.warnings.map((row) => row.code),
  ])
  const has95 = codes.has('self_assessed_vat_unsupported')
  const has96 = codes.has('moneybird_vat_without_tax_rate') || codes.has('moneybird_untagged_vat')
  return { blocked: has95 || has96, showDeadline: has95 }
}

/**
 * Rebuild rate exclusions from persisted `excludedExternalIds` so undo and
 * ‘Niet overgezet’ survive a reload (Legal #105).
 */
export function rebuildExcludedRates(args: {
  readonly excludedExternalIds: readonly string[]
  readonly rates: readonly { readonly moneybirdId: string }[]
  readonly docsForRate: (rateId: string) => readonly string[]
}): { readonly rateIds: Set<string>; readonly byRate: Record<string, string[]> } {
  const excluded = new Set(args.excludedExternalIds)
  const rateIds = new Set<string>()
  const byRate: Record<string, string[]> = {}
  for (const rate of args.rates) {
    const ids = [...args.docsForRate(rate.moneybirdId)]
    if (ids.length === 0) continue
    if (ids.every((id) => excluded.has(id))) {
      rateIds.add(rate.moneybirdId)
      byRate[rate.moneybirdId] = ids
    }
  }
  return { rateIds, byRate }
}
