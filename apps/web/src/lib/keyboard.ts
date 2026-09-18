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
  // `g v` for **v**orderingen and `g c` for **c**rediteuren: `g d` is the
  // dashboard and `g r` the relaties.
  {
    id: 'go.debtorAgeing',
    label: 'keys.goDebtorAgeing',
    group: 'keys.group.goTo',
    keys: 'g v',
    to: '/reports/debtor-ageing',
  },
  {
    id: 'go.creditorAgeing',
    label: 'keys.goCreditorAgeing',
    group: 'keys.group.goTo',
    keys: 'g c',
    to: '/reports/creditor-ageing',
  },

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

  // Every ledger table. `j`/`k` are printed rather than the arrows because
  // `formatBinding` renders a key name, and "ARROWDOWN" is not a key anybody
  // reads — the arrows do the same thing and the map says so.
  { id: 'list.next', label: 'keys.listNext', group: 'keys.group.list', keys: 'j' },
  { id: 'list.previous', label: 'keys.listPrevious', group: 'keys.group.list', keys: 'k' },
  { id: 'list.open', label: 'keys.listOpen', group: 'keys.group.list', keys: 'enter' },
  { id: 'list.select', label: 'keys.listSelect', group: 'keys.group.list', keys: 'space' },
  {
    id: 'list.selectAll',
    label: 'keys.listSelectAll',
    group: 'keys.group.list',
    keys: 'a',
    modifiers: ['mod'],
  },
  {
    id: 'list.copy',
    label: 'keys.listCopy',
    group: 'keys.group.list',
    keys: 'c',
    modifiers: ['mod'],
  },
  { id: 'list.typeAhead', label: 'keys.listTypeAhead', group: 'keys.group.list', keys: 'a-z' },

  // The pickers. Listed because a control you have to click to discover is a
  // control somebody reaches for the mouse for (principle 5).
  { id: 'picker.choose', label: 'keys.pickerChoose', group: 'keys.group.picker', keys: 'enter' },
  { id: 'picker.next', label: 'keys.pickerNext', group: 'keys.group.picker', keys: 'tab' },
  { id: 'picker.close', label: 'keys.pickerClose', group: 'keys.group.picker', keys: 'escape' },

  // The dashboard queue. Four keys, the same four the koppelscherm uses, so
  // the two lists in this application that are worked from the keyboard are
  // worked the same way.
  { id: 'queue.open', label: 'keys.queueOpen', group: 'keys.group.queue', keys: 'enter' },
  { id: 'queue.next', label: 'keys.queueNext', group: 'keys.group.queue', keys: 'j' },
  { id: 'queue.previous', label: 'keys.queuePrevious', group: 'keys.group.queue', keys: 'k' },
  { id: 'queue.leave', label: 'keys.queueLeave', group: 'keys.group.queue', keys: 'escape' },

  { id: 'match.confirm', label: 'keys.matchConfirm', group: 'keys.group.match', keys: 'enter' },
  { id: 'match.pick', label: 'keys.matchPick', group: 'keys.group.match', keys: '1-9' },
  { id: 'match.skip', label: 'keys.matchSkip', group: 'keys.group.match', keys: 'x' },
  { id: 'match.next', label: 'keys.matchNext', group: 'keys.group.match', keys: 'j' },
  { id: 'match.previous', label: 'keys.matchPrevious', group: 'keys.group.match', keys: 'k' },
  { id: 'match.leave', label: 'keys.matchLeave', group: 'keys.group.match', keys: 'escape' },

  // Het postvak, worked with the same four keys as the koppelscherm and the
  // werklijst, plus the two that are this screen's own work: approve and
  // set aside.
  { id: 'inbox.next', label: 'keys.inboxNext', group: 'keys.group.inbox', keys: 'j' },
  { id: 'inbox.previous', label: 'keys.inboxPrevious', group: 'keys.group.inbox', keys: 'k' },
  { id: 'inbox.open', label: 'keys.inboxOpen', group: 'keys.group.inbox', keys: 'enter' },
  { id: 'inbox.approve', label: 'keys.inboxApprove', group: 'keys.group.inbox', keys: 'a' },
  { id: 'inbox.skip', label: 'keys.inboxSkip', group: 'keys.group.inbox', keys: 's' },
  { id: 'inbox.leave', label: 'keys.inboxLeave', group: 'keys.group.inbox', keys: 'escape' },

  {
    id: 'invoiceForm.save',
    label: 'keys.invoiceSave',
    group: 'keys.group.invoiceForm',
    keys: 'enter',
    modifiers: ['mod'],
  },
  {
    id: 'invoiceForm.cancel',
    label: 'keys.invoiceCancel',
    group: 'keys.group.invoiceForm',
    keys: 'escape',
  },
  {
    id: 'invoice.issue',
    label: 'keys.invoiceIssue',
    group: 'keys.group.invoice',
    keys: 'enter',
    modifiers: ['mod'],
  },

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

/** What a key is called on a keycap. `SPACE` is not what is printed on one. */
function keyLabel(key: string): string {
  switch (key) {
    case 'enter':
      return '↵'
    case 'backspace':
      return '⌫'
    case 'escape':
      return 'Esc'
    case 'space':
      return 'Space'
    case 'tab':
      return 'Tab'
    case 'a-z':
      return 'A–Z'
    case '1-9':
      return '1–9'
    default:
      return key.toUpperCase()
  }
}

export function formatBinding(binding: Binding): string {
  const mod = isApple() ? '⌘' : 'Ctrl'
  const parts = (binding.modifiers ?? []).map((modifier) =>
    modifier === 'mod' ? mod : modifier === 'shift' ? '⇧' : '⌥',
  )
  const keys = binding.keys.split(' ').map(keyLabel).join(' then ')
  return [...parts, keys].join(binding.modifiers?.length ? '' : ' ')
}

/**
 * The binding as separate keycaps.
 *
 * `formatBinding` is one string for a sentence; this is what goes on the chrome,
 * where each key is its own printed cap: `⌘↵` is one chord and therefore one
 * cap, while `g` then `d` is two caps with a gap between them, because that is
 * what the hands do.
 */
export function bindingChips(binding: Binding): readonly string[] {
  const mod = isApple() ? '⌘' : 'Ctrl'
  const held = (binding.modifiers ?? [])
    .map((modifier) => (modifier === 'mod' ? mod : modifier === 'shift' ? '⇧' : '⌥'))
    .join('')
  return binding.keys.split(' ').map((key, index) => (index === 0 ? held : '') + keyLabel(key))
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
