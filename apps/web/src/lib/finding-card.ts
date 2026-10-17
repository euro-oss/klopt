/**
 * Finding with fix — stable props contract (issue #41 Phase 1).
 *
 * Phase 2 may reskin visuals (Designer's Penpot boards) but must not change
 * these types or require callers to change. See `docs/finding-card.md`.
 *
 * Honesty: unread ≠ empty ≠ reconciled. Yellow is the product accent and never
 * means error. A one-click fix never posts; if the books would change, a
 * preview is shown first.
 */

import { formatMinorUnits } from '@klopt/core/format'

/** Blocking is red; warning is neutral. Yellow is never severity. */
export type FindingSeverity = 'blocking' | 'warning'

/**
 * What we honestly know about a source we checked.
 *
 * - `unread` — we could not read it (not the same as empty).
 * - `empty` — we read it and there was nothing.
 * - `reconciled` — we read it and it balances / matches.
 */
export type FindingHonesty = 'unread' | 'empty' | 'reconciled'

/** Detail as the API sends it; amount fields may be minor-unit strings. */
export type FindingDetail = Readonly<Record<string, string>>

/**
 * Preview shown before a one-click fix that would change the books.
 *
 * Amounts in `lines` must already be euros (never minor units / cents).
 */
export interface FindingFixPreview {
  readonly summary: string
  readonly lines?: readonly {
    readonly label: string
    readonly value: string
  }[]
}

/**
 * The fix slot. Three types, discriminated on `type`.
 *
 * - `oneClick` — apply after optional preview; never posts on first activation
 *   when `preview` is set.
 * - `guided` — opens a multi-step flow the card hosts.
 * - `explainOnly` — honest "you cannot fix this here", optional link elsewhere.
 */
export type FindingFix =
  | {
      readonly type: 'oneClick'
      /** Button label, already translated by the caller. */
      readonly label: string
      /**
       * Required whenever applying would mutate ledger state. Opening the fix
       * shows this preview; only confirming after that may call `onApply`.
       * Omit when the action does not change the books (still must not post).
       */
      readonly preview?: FindingFixPreview
      readonly onApply: () => void | Promise<void>
    }
  | {
      readonly type: 'guided'
      readonly label: string
      readonly onOpen: () => void
      /** Optional step labels shown when the fix panel is open. */
      readonly steps?: readonly string[]
    }
  | {
      readonly type: 'explainOnly'
      /** Where the user can fix this, if anywhere. */
      readonly href?: string
      readonly linkLabel?: string
    }

/**
 * Data shape every finding already carries on the wire (Moneybird / inbound).
 * Exact may omit `messageKey` until #46; callers then pass `message` only.
 */
export interface FindingData {
  readonly code: string
  readonly path?: string | null
  readonly messageKey: string
  readonly detail?: FindingDetail | null
  /** English sentence from the API — fallback when no translation exists. */
  readonly message: string
}

/** Full card props. Phase 2 visual reskin must keep this surface stable. */
export interface FindingCardModel extends FindingData {
  readonly severity: FindingSeverity
  readonly fix: FindingFix
  /** Optional honesty chrome (trial balance / reconciliation). */
  readonly honesty?: FindingHonesty
}

/** Keys in `detail` that are minor-unit amounts and must render as euros. */
export const AMOUNT_DETAIL_KEYS: ReadonlySet<string> = new Set([
  'debit',
  'credit',
  'declared',
  'fromLines',
  'net',
  'lineNet',
  'netMinorUnits',
  'total',
  'rubriek3b',
  'salesOverdueTotal',
])

/**
 * Detail values ready for `t('finding.' + messageKey, detail)`.
 *
 * Amount fields become euro strings with tabular presentation in mind; other
 * keys pass through. Never leaves "minor units" or "centen" for the reader.
 */
export function detailForDisplay(detail: FindingDetail | null | undefined): FindingDetail {
  if (detail === null || detail === undefined) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(detail)) {
    if (AMOUNT_DETAIL_KEYS.has(key) && /^-?\d+$/.test(value)) {
      try {
        out[key] = formatMinorUnits(BigInt(value))
      } catch {
        out[key] = value
      }
    } else {
      out[key] = value
    }
  }
  return out
}

/** Tailwind classes for severity — blocking red, warning neutral, never yellow. */
export function severityClasses(severity: FindingSeverity): {
  readonly border: string
  readonly bar: string
  readonly title: string
  readonly body: string
} {
  if (severity === 'blocking') {
    return {
      border: 'border-destructive/40',
      // Design: red status bar on the leading edge (Phase 2 may thicken it).
      bar: 'border-l-4 border-l-destructive',
      title: 'text-destructive',
      body: 'text-foreground',
    }
  }
  return {
    border: 'border-border',
    bar: 'border-l-4 border-l-muted-foreground/40',
    title: 'text-muted-foreground',
    body: 'text-foreground',
  }
}

/** Tailwind classes for honesty — three states that must not look alike. */
export function honestyClasses(honesty: FindingHonesty): {
  readonly border: string
  readonly text: string
  readonly tone: 'muted' | 'neutral' | 'good'
} {
  switch (honesty) {
    case 'unread':
      // Absent, not wrong — muted, never destructive or accent.
      return { border: 'border-dashed border-border', text: 'text-muted-foreground', tone: 'muted' }
    case 'empty':
      // Read and vacant — solid border, still neutral.
      return { border: 'border-border', text: 'text-foreground', tone: 'neutral' }
    case 'reconciled':
      // Read and balanced — confident foreground; Phase 2 may tint green.
      return { border: 'border-foreground', text: 'text-foreground', tone: 'good' }
  }
}

/**
 * Map a reconciliation `source` (+ balanced) onto honesty.
 *
 * Unbalanced-but-read is not an honesty state — that is a finding. Callers
 * show the finding list; this helper only covers the three honest claims.
 */
export function honestyFromReconciliation(
  source: 'read' | 'empty' | 'unreadable',
  balanced: boolean | null | undefined,
): FindingHonesty | null {
  if (source === 'unreadable') return 'unread'
  if (source === 'empty') return 'empty'
  if (balanced === true) return 'reconciled'
  return null
}

export type FindingCursorState = {
  readonly index: number
  readonly count: number
  /** Index of the finding whose fix panel is open, or null. */
  readonly openFix: number | null
}

export type FindingCursorAction =
  | { readonly action: 'move'; readonly index: number }
  | { readonly action: 'openFix'; readonly index: number }
  | { readonly action: 'closeFix' }
  | { readonly action: 'leave' }
  | { readonly action: 'ignore' }

/**
 * Keyboard for a findings list: j/k move, Enter opens the fix, Escape closes.
 *
 * Modified keys are ignored so Cmd+K / Ctrl+Enter stay global. When a fix is
 * open, Escape closes it before leaving the list.
 */
export function resolveFindingKey(
  key: string,
  state: FindingCursorState,
  modified = false,
): FindingCursorAction {
  if (modified) return { action: 'ignore' }
  if (state.count === 0) return key === 'Escape' ? { action: 'leave' } : { action: 'ignore' }

  const last = state.count - 1
  const here = Math.min(Math.max(state.index, 0), last)

  if (state.openFix !== null) {
    if (key === 'Escape') return { action: 'closeFix' }
    // While a fix is open, movement still works; Enter is reserved for confirm
    // inside the fix panel (handled by the card, not here).
    if (key === 'j' || key === 'ArrowDown') {
      return { action: 'move', index: Math.min(here + 1, last) }
    }
    if (key === 'k' || key === 'ArrowUp') {
      return { action: 'move', index: Math.max(here - 1, 0) }
    }
    return { action: 'ignore' }
  }

  switch (key) {
    case 'j':
    case 'ArrowDown':
      return { action: 'move', index: Math.min(here + 1, last) }
    case 'k':
    case 'ArrowUp':
      return { action: 'move', index: Math.max(here - 1, 0) }
    case 'Home':
      return { action: 'move', index: 0 }
    case 'End':
      return { action: 'move', index: last }
    case 'Enter':
      return { action: 'openFix', index: here }
    case 'Escape':
      return { action: 'leave' }
    default:
      return { action: 'ignore' }
  }
}

/**
 * Whether a one-click activation may call `onApply` immediately.
 *
 * False when a preview exists — the card must show the preview first.
 */
export function oneClickMayApplyImmediately(fix: FindingFix): boolean {
  return fix.type === 'oneClick' && fix.preview === undefined
}

/** Default Phase 1 fix when no per-code fix exists yet (#42). */
export function explainOnlyFix(link?: { href: string; linkLabel: string }): FindingFix {
  if (link === undefined) return { type: 'explainOnly' }
  return { type: 'explainOnly', href: link.href, linkLabel: link.linkLabel }
}
