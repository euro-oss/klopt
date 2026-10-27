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
  /** Opening-balance journals posted; booked but not Klaar documents (#105 PM). */
  readonly openingEntriesPosted?: number | null
  readonly invoicesImported?: number | null
  readonly entriesReplayed?: number | null
  readonly entriesSkipped?: number | null
  readonly bankTransactionsCreated?: number | null
  readonly opening?: { readonly year?: number } | null
  readonly problems?: readonly { readonly code: string }[]
  readonly warnings?: readonly { readonly code: string }[]
  readonly excluded?: readonly string[]
  readonly notImported?: readonly string[]
}

export interface ImportRunStatusView {
  readonly requested?: boolean
  readonly state?: ImportRunState
  readonly workerSilent?: boolean
  readonly report?: ImportRunReportView | null
  readonly lastError?: string | null
}

/** Entries/documents the worker actually booked (post-commit or done). */
export function bookedCountFromReport(report: ImportRunReportView | null | undefined): number {
  if (report === null || report === undefined) return 0
  const posted = report.entriesPosted ?? 0
  const openings = report.openingEntriesPosted ?? 0
  const invoices = report.invoicesImported ?? 0
  const replayed = report.entriesReplayed ?? 0
  const bank = report.bankTransactionsCreated ?? 0
  return (
    Math.max(posted, 0) +
    Math.max(openings, 0) +
    Math.max(invoices, 0) +
    Math.max(replayed, 0) +
    Math.max(bank, 0)
  )
}

/**
 * Document count for Klaar summary: every booked document type from the run
 * report (invoices, journals, bank mutations, …), so Klaar matches step 8.
 * Prefer `entriesPosted` (one journal entry per transferred document); fall
 * back to typed counters when the flattened report omits it.
 *
 * Opening-balance journals are never documents on Klaar (#105 PM r4). New
 * reports keep them in `openingEntriesPosted` (not in `entriesPosted`). Legacy
 * reports that folded them into `entriesPosted` subtract exactly one when
 * `opening` is present — even if Moneybird had more than one `origin: opening`
 * journal. That approximation only affects old reports without
 * `openingEntriesPosted` (#105 PM r5 nit).
 */
export function klaarTransferCount(report: ImportRunReportView | null | undefined): number {
  if (report === null || report === undefined) return 0
  if (typeof report.entriesPosted === 'number' && report.entriesPosted >= 0) {
    if (typeof report.openingEntriesPosted === 'number') {
      return report.entriesPosted
    }
    // Legacy: subtract exactly one opening journal when `opening` is set.
    const legacyOpening = report.opening !== null && report.opening !== undefined ? 1 : 0
    return Math.max(0, report.entriesPosted - legacyOpening)
  }
  const invoices = report.invoicesImported ?? 0
  const bank = report.bankTransactionsCreated ?? 0
  const replayed = report.entriesReplayed ?? 0
  return Math.max(0, invoices) + Math.max(0, bank) + Math.max(0, replayed)
}

/**
 * Distinct documents in `year` that use a rate whose proposed/previous/mapped
 * Klopt code is not yet in force — de-duplicated by externalId (#105 Designer).
 */
export function countNotInForceDocuments(args: {
  readonly year: string
  readonly usedRates: readonly {
    readonly moneybirdId: string
    readonly proposedCode?: string | null
    readonly candidates?: readonly { readonly code: string }[]
  }[]
  readonly taxMappings: Readonly<Record<string, string>>
  readonly previousTaxMappings: Readonly<Record<string, string>>
  readonly taxCodeValidFromIso: ReadonlyMap<string, string>
  readonly docsForRate: (rateId: string) => readonly string[]
  readonly yearDocuments: readonly { readonly year: number | string; readonly externalId: string }[]
}): { readonly count: number; readonly codes: ReadonlySet<string> } {
  const yearStart = `${args.year}-01-01`
  const codes = new Set<string>()
  const ids = new Set<string>()
  for (const rate of args.usedRates) {
    const code =
      args.taxMappings[rate.moneybirdId] ??
      args.previousTaxMappings[rate.moneybirdId] ??
      rate.proposedCode ??
      rate.candidates?.[0]?.code ??
      null
    if (code === null || code === '') continue
    const validFrom = args.taxCodeValidFromIso.get(code)
    if (validFrom === undefined || validFrom <= yearStart) continue
    codes.add(code)
    const rateDocs = args.docsForRate(rate.moneybirdId)
    if (rateDocs.length > 0) {
      for (const id of rateDocs) {
        const doc = args.yearDocuments.find((row) => row.externalId === id)
        if (doc !== undefined && String(doc.year) === args.year) ids.add(id)
      }
    } else {
      // unmapped_tax_rate findings may omit references; still de-dupe by
      // externalId so two affected rates never double-count the year.
      for (const doc of args.yearDocuments) {
        if (String(doc.year) === args.year) ids.add(doc.externalId)
      }
    }
  }
  return { count: ids.size, codes }
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

/**
 * Step 9 title/footer when the run has stopped (#105 PM r4).
 * Never return busy/transferring copy for `failed` / `failedPartial`.
 */
export function importerenStoppedChrome(failureKind: ImportFailureKind): {
  readonly stopped: boolean
} {
  return {
    stopped: failureKind === 'failed' || failureKind === 'failedPartial',
  }
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
