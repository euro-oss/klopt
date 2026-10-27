import type { MessageKey } from '~/i18n/nl'
import { MAY_EXPORT_AUDIT_FILE, MAY_MANAGE_TAX_CODES, MAY_OPEN_YEAR } from './roles'

/**
 * Shell navigation IA (#61 slice 2 / #57).
 *
 * Shared by the rail, the phone Sheet, and ⌘K so labels and order stay one
 * source of truth. `advancedOnly` items leave the nav when Geavanceerd is off
 * but stay in ⌘K (last). `advancedKey` swaps the plain-language label for the
 * ledger term when Geavanceerd is on.
 */

export interface NavItem {
  readonly to: string
  readonly key: MessageKey
  /** Label when Geavanceerd is on; `key` is the simple-mode word. */
  readonly advancedKey?: MessageKey
  readonly binding?: string
  readonly roles?: readonly string[]
  /** Hidden from the nav when Geavanceerd is off; still in ⌘K. */
  readonly advancedOnly?: boolean
  /** Optional search params (e.g. import wizard `?bron=`). */
  readonly search?: Readonly<Record<string, string>>
}

export interface NavGroup {
  /** Absent for the opening group, which needs no heading to be understood. */
  readonly key?: MessageKey
  readonly items: readonly NavItem[]
}

export const NAVIGATION: readonly NavGroup[] = [
  { items: [{ to: '/', key: 'nav.dashboard', binding: 'go.dashboard' }] },
  {
    key: 'nav.group.sales',
    items: [
      { to: '/invoices', key: 'nav.invoices', binding: 'go.invoices' },
      { to: '/contacts', key: 'nav.contacts', binding: 'go.contacts' },
      { to: '/dunning', key: 'nav.dunning', binding: 'go.dunning' },
    ],
  },
  {
    key: 'nav.group.purchasing',
    items: [
      { to: '/inbox', key: 'nav.inbox', binding: 'go.inbox' },
      { to: '/purchases', key: 'nav.purchases', binding: 'go.purchases' },
    ],
  },
  {
    key: 'nav.group.money',
    items: [
      { to: '/bank', key: 'nav.bank', binding: 'go.bank' },
      { to: '/bank/match', key: 'nav.match', binding: 'go.match' },
      { to: '/payments', key: 'nav.payments', binding: 'go.payments' },
    ],
  },
  {
    key: 'nav.group.books',
    items: [
      { to: '/vat', key: 'nav.vat', binding: 'go.vat' },
      {
        to: '/accounts',
        key: 'nav.categories',
        advancedKey: 'nav.accounts',
        binding: 'go.accounts',
      },
      { to: '/entries', key: 'nav.entries', binding: 'go.journal', advancedOnly: true },
    ],
  },
  {
    key: 'nav.group.reports',
    items: [
      { to: '/reports/profit-and-loss', key: 'nav.profitAndLoss', binding: 'go.profit' },
      { to: '/reports/balance-sheet', key: 'nav.balanceSheet', binding: 'go.balance' },
      {
        to: '/reports/debtor-ageing',
        key: 'nav.debtorsPlain',
        advancedKey: 'nav.debtorAgeing',
        binding: 'go.debtorAgeing',
      },
      { to: '/reports/creditor-ageing', key: 'nav.creditorAgeing', binding: 'go.creditorAgeing' },
      {
        to: '/reports/trial-balance',
        key: 'nav.trialBalance',
        binding: 'go.trial',
        advancedOnly: true,
      },
    ],
  },
  // Importers sit above Beheer: bringing books in is a daily-path question for
  // a firm that still lives in Exact or Moneybird, not a settings chore (#37).
  {
    key: 'nav.group.import',
    items: [
      {
        to: '/importeren',
        key: 'nav.importMoneybird',
        binding: 'go.moneybird',
        roles: ['owner', 'accountant', 'bookkeeper'],
        search: { bron: 'moneybird' },
      },
      {
        to: '/importeren',
        key: 'nav.importExact',
        binding: 'go.exact',
        roles: ['owner', 'accountant', 'bookkeeper'],
        search: { bron: 'exact' },
      },
      {
        to: '/exact',
        key: 'nav.exactAdvanced',
        binding: 'go.exactLegacy',
        roles: ['owner', 'accountant', 'bookkeeper'],
        advancedOnly: true,
      },
    ],
  },
  {
    key: 'nav.group.admin',
    items: [
      {
        to: '/settings',
        key: 'nav.settings',
        binding: 'go.settings',
        roles: ['owner', 'accountant', 'bookkeeper'],
      },
      { to: '/members', key: 'nav.members', binding: 'go.members', roles: ['owner'] },
      {
        to: '/fiscal-years',
        key: 'nav.fiscalYears',
        binding: 'go.fiscalYears',
        roles: MAY_OPEN_YEAR,
      },
      {
        to: '/tax-codes',
        key: 'nav.taxCodes',
        binding: 'go.taxCodes',
        roles: MAY_MANAGE_TAX_CODES,
      },
      {
        to: '/audit-file',
        key: 'nav.auditFile',
        binding: 'go.auditFile',
        roles: MAY_EXPORT_AUDIT_FILE,
      },
      // `tokens:manage`, like the tokens it sits beside: a webhook is a
      // standing grant of information to a third party. Spelled as `owner`
      // here because there is no MAY_* list for tokens yet — do not copy this
      // pattern onto screens that already share a list with ~/lib/roles.
      { to: '/webhooks', key: 'nav.webhooks', binding: 'go.webhooks', roles: ['owner'] },
      // `ledger:export` is what the operation needs, and the roles that hold it
      // are the ones who would be asked for the log.
      {
        to: '/audit-log',
        key: 'nav.auditLog',
        binding: 'go.audit',
        roles: ['owner', 'accountant', 'auditor'],
      },
      // The preview needs `ledger:export`; changing anything needs
      // `retention:manage`, which only the owner holds. Both are on this screen
      // and the screen says which is which.
      {
        to: '/retention',
        key: 'nav.retention',
        binding: 'go.retention',
        roles: ['owner', 'accountant', 'auditor'],
      },
      // `ledger:read` sees them, `ledger:export` makes them. A seal nobody can
      // see is a seal nobody checks, so the bookkeeper gets the screen too.
      {
        to: '/snapshots',
        key: 'nav.snapshots',
        binding: 'go.snapshots',
        roles: ['owner', 'accountant', 'auditor', 'bookkeeper'],
      },
    ],
  },
]

/** Search bag from the router (`location.search`) or a plain record / URLSearchParams. */
export type NavSearch =
  | Readonly<Record<string, unknown>>
  | URLSearchParams
  | { readonly bron?: string }
  | null
  | undefined

function searchBron(search: NavSearch): string | undefined {
  if (search === undefined || search === null) return undefined
  if (search instanceof URLSearchParams) {
    const value = search.get('bron')
    return value === null || value === '' ? undefined : value
  }
  const value = (search as Record<string, unknown>)['bron']
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Prefer the longest matching destination so `/bank` does not steal `/bank/match`.
 *
 * When `itemSearch` carries `bron` (import wizard), the current `bron` must
 * match. Missing current `bron` defaults to moneybird so only that row lights up.
 */
export function isNavActive(
  path: string,
  to: string,
  currentSearch?: NavSearch,
  itemSearch?: Readonly<Record<string, string>>,
): boolean {
  if (to === '/') return path === '/'
  if (path !== to && !path.startsWith(`${to}/`)) return false
  const destinations = NAVIGATION.flatMap((group) => group.items.map((item) => item.to))
  const pathActive = !destinations.some(
    (other) =>
      other !== to &&
      other.startsWith(`${to}/`) &&
      (path === other || path.startsWith(`${other}/`)),
  )
  if (!pathActive) return false
  const itemBron = itemSearch?.['bron']
  if (itemBron === undefined) return true
  const currentBron = searchBron(currentSearch) ?? 'moneybird'
  return currentBron === itemBron
}

export function navLabelKey(item: NavItem, advanced: boolean): MessageKey {
  return advanced && item.advancedKey !== undefined ? item.advancedKey : item.key
}

/** Active page title from the nav, or null when the path is not a destination. */
export function pageTitleKey(
  path: string,
  advanced: boolean,
  currentSearch?: NavSearch,
): MessageKey | null {
  let best: { to: string; key: MessageKey } | null = null
  for (const group of NAVIGATION) {
    for (const item of group.items) {
      if (!isNavActive(path, item.to, currentSearch, item.search)) continue
      if (best === null || item.to.length > best.to.length) {
        best = { to: item.to, key: navLabelKey(item, advanced) }
      }
    }
  }
  return best?.key ?? null
}

/**
 * Nav destinations for ⌘K: daily-work order, simple labels when Geavanceerd is
 * off, and advanced-only items (Journaalposten / Proefbalans) last.
 */
export function paletteNavItems(
  role: string,
  advanced: boolean,
): readonly { item: NavItem; groupKey: MessageKey | undefined }[] {
  const primary: { item: NavItem; groupKey: MessageKey | undefined }[] = []
  const deferred: { item: NavItem; groupKey: MessageKey | undefined }[] = []
  for (const group of NAVIGATION) {
    for (const item of group.items) {
      if (item.binding === undefined) continue
      if (item.roles !== undefined && !item.roles.includes(role)) continue
      // Legacy Exact (oud): ⌘K only when Geavanceerd is on (#105 Designer).
      if (!advanced && item.advancedOnly === true && item.binding === 'go.exactLegacy') {
        continue
      }
      const row = { item, groupKey: group.key }
      if (!advanced && item.advancedOnly === true) deferred.push(row)
      else primary.push(row)
    }
  }
  return advanced ? primary : [...primary, ...deferred]
}
