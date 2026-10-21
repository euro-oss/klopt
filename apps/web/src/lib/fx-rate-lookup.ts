/**
 * Koers / ECB lookup UX helpers (Moneybird FX step).
 *
 * Pure so unit tests can cover slow-hint timing, result suppression when the
 * user types during a fetch, and live-region announcement text without a
 * React mount (web vitest is node-only).
 */

/** After this many ms still loading, show the “you can type it yourself” hint. */
export const FX_LOOKUP_SLOW_HINT_MS = 3_000

export type FxLookupLiveKind = 'idle' | 'loading' | 'success' | 'error'

export interface FxLookupApplyGate {
  /** Monotonic id of the in-flight lookup that produced the result. */
  readonly resultGeneration: number
  /** Generation currently owned by the sheet (bumped on each new lookup). */
  readonly currentGeneration: number
  /** True once the user edited the rate field during the in-flight lookup. */
  readonly userEditedDuringLookup: boolean
}

/**
 * Whether an async ECB lookup result may overwrite the rate field.
 * Typed values always win: a newer generation or a mid-flight edit drops it.
 */
export function shouldApplyFxLookupResult(gate: FxLookupApplyGate): boolean {
  if (gate.resultGeneration !== gate.currentGeneration) return false
  if (gate.userEditedDuringLookup) return false
  return true
}

/** Whether the slow-path hint should show for an elapsed loading duration. */
export function shouldShowFxLookupSlowHint(
  loading: boolean,
  elapsedMs: number,
  thresholdMs: number = FX_LOOKUP_SLOW_HINT_MS,
): boolean {
  return loading && elapsedMs >= thresholdMs
}

export function fxLookupLiveKind(args: {
  readonly loading: boolean
  readonly error: string | null | undefined
  readonly hasEcbRate: boolean
}): FxLookupLiveKind {
  if (args.loading) return 'loading'
  if (args.error !== null && args.error !== undefined && args.error !== '') return 'error'
  if (args.hasEcbRate) return 'success'
  return 'idle'
}

/**
 * ISO `YYYY-MM-DD` → `DD-MM-YYYY` for live-region / UI copy (NL and EN).
 * Unknown shapes pass through unchanged.
 */
export function formatFxAnnouncementDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match === null) return iso
  return `${match[3]}-${match[2]}-${match[1]}`
}

export interface FxLookupDraftSeed {
  readonly externalId: string
  readonly currency: string
  readonly documentDate: string
  readonly rate: string
  readonly ecbRate: string
  readonly source: 'ecb' | 'override'
  readonly date: string
  readonly userEditedDuringLookup: boolean
}

/**
 * Start or re-start an ECB lookup. A retry for the same document keeps the
 * typed rate (and related fields); a fresh open starts empty.
 */
export function nextFxLookupDraft(
  current: FxLookupDraftSeed | null,
  args: {
    readonly externalId: string
    readonly currency: string
    readonly documentDate: string
  },
): FxLookupDraftSeed & { readonly loading: true; readonly error: null } {
  if (current !== null && current.externalId === args.externalId) {
    return {
      ...current,
      loading: true,
      error: null,
      // Intentional refresh may apply ECB when it returns; typing mid-flight
      // sets userEditedDuringLookup again via onRateChange.
      userEditedDuringLookup: false,
    }
  }
  return {
    externalId: args.externalId,
    currency: args.currency,
    documentDate: args.documentDate,
    rate: '',
    ecbRate: '',
    source: 'ecb',
    date: args.documentDate,
    loading: true,
    error: null,
    userEditedDuringLookup: false,
  }
}
