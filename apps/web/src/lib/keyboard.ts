/**
 * The keyboard map, as data (docs/keyboard-map.md).
 *
 * Screens declare **intent** — "post the entry" — and never a key. Two reasons:
 * the command palette is generated from this registry, so a binding that is not
 * discoverable does not exist; and `Cmd` versus `Ctrl` is resolved once here
 * rather than in forty components.
 *
 * A screen that writes `event.key === 'k'` is a bug.
 */

import type { MessageKey } from '~/i18n/nl'

export type Modifier = 'mod' | 'shift' | 'alt'

export interface Binding {
  /** Stable id, used by the palette and by tests. */
  readonly id: string
  /** Message keys, not words: the palette is read in the reader's language. */
  readonly label: MessageKey
  readonly group: MessageKey
  /** Lowercase key, or a two-key sequence like `g d`. */
  readonly keys: string
  readonly modifiers?: readonly Modifier[]
  /** Absent for navigation entries, which the palette resolves to a route. */
  readonly to?: string
}

export const BINDINGS: readonly Binding[] = [
  {
    id: 'palette',
    label: 'keys.palette',
    group: 'keys.group.global',
    keys: 'k',
    modifiers: ['mod'],
  },
  { id: 'help', label: 'keys.help', group: 'keys.group.global', keys: '?' },

  { id: 'go.dashboard', label: 'nav.dashboard', group: 'keys.group.goTo', keys: 'g d', to: '/' },
  { id: 'go.journal', label: 'nav.entries', group: 'keys.group.goTo', keys: 'g j', to: '/entries' },
  {
    id: 'go.accounts',
    label: 'accounts.title',
    group: 'keys.group.goTo',
    keys: 'g a',
    to: '/accounts',
  },
  {
    id: 'go.balance',
    label: 'nav.balanceSheet',
    group: 'keys.group.goTo',
    keys: 'g b',
    to: '/reports/balance-sheet',
  },
  {
    id: 'go.profit',
    label: 'keys.goProfitAndLoss',
    group: 'keys.group.goTo',
    keys: 'g w',
    to: '/reports/profit-and-loss',
  },
  {
    id: 'go.trial',
    label: 'nav.trialBalance',
    group: 'keys.group.goTo',
    keys: 'g p',
    to: '/reports/trial-balance',
  },
  {
    id: 'go.invoices',
    label: 'nav.invoices',
    group: 'keys.group.goTo',
    keys: 'g f',
    to: '/invoices',
  },
  {
    id: 'go.purchases',
    label: 'nav.purchases',
    group: 'keys.group.goTo',
    keys: 'g n',
    to: '/purchases',
  },
  { id: 'go.inbox', label: 'nav.inbox', group: 'keys.group.goTo', keys: 'g e', to: '/inbox' },
  {
    id: 'go.contacts',
    label: 'nav.contacts',
    group: 'keys.group.goTo',
    keys: 'g r',
    to: '/contacts',
  },
  { id: 'go.bank', label: 'nav.bank', group: 'keys.group.goTo', keys: 'g k', to: '/bank' },
  {
    id: 'go.match',
    label: 'match.title',
    group: 'keys.group.goTo',
    keys: 'g o',
    to: '/bank/match',
  },
  {
    id: 'go.payments',
    label: 'nav.payments',
    group: 'keys.group.goTo',
    keys: 'g y',
    to: '/payments',
  },
  { id: 'go.dunning', label: 'nav.dunning', group: 'keys.group.goTo', keys: 'g m', to: '/dunning' },
  // `g g` for aan**g**ifte. `g b`, `g t` and `g w` were all taken by the time
  // BTW arrived, which is what happens when a keyboard map is real.
  { id: 'go.vat', label: 'keys.goVat', group: 'keys.group.goTo', keys: 'g g', to: '/vat' },
  { id: 'go.members', label: 'nav.members', group: 'keys.group.goTo', keys: 'g t', to: '/members' },
  // `g w` is the winst-en-verlies and `g k` the bank, so `g u` for uitgaand.
  {
    id: 'go.webhooks',
    label: 'nav.webhooks',
    group: 'keys.group.goTo',
    keys: 'g u',
    to: '/webhooks',
  },
  {
    id: 'go.settings',
    label: 'nav.settings',
    group: 'keys.group.goTo',
    keys: 'g i',
    to: '/settings',
  },
  // `g l` for **l**og. `g a` is the grootboek and `g w` the winst-en-verlies.
  {
    id: 'go.audit',
    label: 'nav.auditLog',
    group: 'keys.group.goTo',
    keys: 'g l',
    to: '/audit-log',
  },
  // `g h` for bewaren, since `g b` is the balans and `g w` the winst-en-verlies.
  {
    id: 'go.retention',
    label: 'nav.retention',
    group: 'keys.group.goTo',
    keys: 'g h',
    to: '/retention',
  },
  // `g z` for **z**egel. `g s` is unclaimed but reads as "settings" to anybody
  // who has used another application, and `g i` already is Instellingen.
  {
    id: 'go.snapshots',
    label: 'nav.snapshots',
    group: 'keys.group.goTo',
    keys: 'g z',
    to: '/snapshots',
  },
  // `g x` for E**x**act. `g e` is the postvak and `g o` the koppelscherm.
  { id: 'go.exact', label: 'nav.exact', group: 'keys.group.goTo', keys: 'g x', to: '/exact' },

  {
    id: 'new.entry',
    label: 'entryNew.title',
    group: 'keys.group.new',
    keys: 'n j',
    to: '/entries/new',
  },
  {
    id: 'new.invoice',
    label: 'keys.newInvoice',
    group: 'keys.group.new',
    keys: 'n f',
    to: '/invoices/new',
  },
  {
    id: 'new.purchase',
    label: 'purchaseNew.title',
    group: 'keys.group.new',
    keys: 'n i',
    to: '/purchases/new',
  },

  { id: 'match.confirm', label: 'keys.matchConfirm', group: 'keys.group.match', keys: 'enter' },
  { id: 'match.skip', label: 'keys.matchSkip', group: 'keys.group.match', keys: 'x' },
  { id: 'match.next', label: 'keys.matchNext', group: 'keys.group.match', keys: 'j' },
  { id: 'match.previous', label: 'keys.matchPrevious', group: 'keys.group.match', keys: 'k' },

  {
    id: 'entry.post',
    label: 'keys.entryPost',
    group: 'keys.group.entry',
    keys: 'enter',
    modifiers: ['mod'],
  },
  {
    id: 'entry.postAndNext',
    label: 'keys.entryPostAndNext',
    group: 'keys.group.entry',
    keys: 'enter',
    modifiers: ['mod', 'shift'],
  },
  {
    id: 'entry.duplicateLine',
    label: 'keys.entryDuplicateLine',
    group: 'keys.group.entry',
    keys: 'd',
    modifiers: ['mod'],
  },
  {
    id: 'entry.deleteLine',
    label: 'keys.entryDeleteLine',
    group: 'keys.group.entry',
    keys: 'backspace',
    modifiers: ['mod'],
  },
]

export const BINDINGS_BY_ID: ReadonlyMap<string, Binding> = new Map(
  BINDINGS.map((binding) => [binding.id, binding]),
)

/** `mod` is Cmd on a Mac and Ctrl everywhere else. Decided once. */
export function isApple(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
}

export function formatBinding(binding: Binding): string {
  const mod = isApple() ? '⌘' : 'Ctrl'
  const parts = (binding.modifiers ?? []).map((modifier) =>
    modifier === 'mod' ? mod : modifier === 'shift' ? '⇧' : '⌥',
  )
  const keys = binding.keys
    .split(' ')
    .map((key) => (key === 'enter' ? '↵' : key === 'backspace' ? '⌫' : key.toUpperCase()))
    .join(' then ')
  return [...parts, keys].join(binding.modifiers?.length ? '' : ' ')
}

export function matches(binding: Binding, event: KeyboardEvent): boolean {
  if (binding.keys.includes(' ')) return false

  const wantsMod = binding.modifiers?.includes('mod') ?? false
  const wantsShift = binding.modifiers?.includes('shift') ?? false
  const hasMod = isApple() ? event.metaKey : event.ctrlKey

  if (wantsMod !== hasMod) return false
  if (wantsShift !== event.shiftKey) return false
  return event.key.toLowerCase() === binding.keys
}

/** True when the user is typing and a bare-letter shortcut must not fire. */
export function isTypingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
