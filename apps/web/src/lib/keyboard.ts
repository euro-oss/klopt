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

export type Modifier = 'mod' | 'shift' | 'alt'

export interface Binding {
  /** Stable id, used by the palette and by tests. */
  readonly id: string
  readonly label: string
  readonly group: string
  /** Lowercase key, or a two-key sequence like `g d`. */
  readonly keys: string
  readonly modifiers?: readonly Modifier[]
  /** Absent for navigation entries, which the palette resolves to a route. */
  readonly to?: string
}

export const BINDINGS: readonly Binding[] = [
  { id: 'palette', label: 'Command palette', group: 'Global', keys: 'k', modifiers: ['mod'] },
  { id: 'help', label: 'Keyboard help', group: 'Global', keys: '?' },

  { id: 'go.dashboard', label: 'Dashboard', group: 'Go to', keys: 'g d', to: '/' },
  { id: 'go.journal', label: 'Journaalposten', group: 'Go to', keys: 'g j', to: '/entries' },
  { id: 'go.accounts', label: 'Grootboekrekeningen', group: 'Go to', keys: 'g a', to: '/accounts' },
  { id: 'go.balance', label: 'Balans', group: 'Go to', keys: 'g b', to: '/reports/balance-sheet' },
  {
    id: 'go.profit',
    label: 'Winst- en verliesrekening',
    group: 'Go to',
    keys: 'g w',
    to: '/reports/profit-and-loss',
  },
  {
    id: 'go.trial',
    label: 'Proefbalans',
    group: 'Go to',
    keys: 'g p',
    to: '/reports/trial-balance',
  },
  { id: 'go.invoices', label: 'Verkoopfacturen', group: 'Go to', keys: 'g f', to: '/invoices' },
  { id: 'go.contacts', label: 'Relaties', group: 'Go to', keys: 'g r', to: '/contacts' },
  { id: 'go.members', label: 'Toegang', group: 'Go to', keys: 'g t', to: '/members' },
  { id: 'go.settings', label: 'Instellingen', group: 'Go to', keys: 'g i', to: '/settings' },

  {
    id: 'new.entry',
    label: 'Nieuwe journaalpost',
    group: 'Nieuw',
    keys: 'n j',
    to: '/entries/new',
  },
  { id: 'new.invoice', label: 'Nieuwe factuur', group: 'Nieuw', keys: 'n f', to: '/invoices/new' },

  {
    id: 'entry.post',
    label: 'Post entry',
    group: 'Journaalpost',
    keys: 'enter',
    modifiers: ['mod'],
  },
  {
    id: 'entry.postAndNext',
    label: 'Post and start another',
    group: 'Journaalpost',
    keys: 'enter',
    modifiers: ['mod', 'shift'],
  },
  {
    id: 'entry.duplicateLine',
    label: 'Duplicate line',
    group: 'Journaalpost',
    keys: 'd',
    modifiers: ['mod'],
  },
  {
    id: 'entry.deleteLine',
    label: 'Delete line',
    group: 'Journaalpost',
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
