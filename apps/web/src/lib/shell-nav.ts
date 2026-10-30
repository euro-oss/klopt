import type { MessageKey } from '~/i18n/nl'
import { MAY_EXPORT_AUDIT_FILE, MAY_MANAGE_TAX_CODES, MAY_OPEN_YEAR } from './roles'

/**
 * Shell navigation — Phase 0 redesign (#107).
 *
 * One config array drives the rail, the phone Sheet, and ⌘K. Primary items are
 * the export's eight flat destinations; footer is Settings + Shortcuts.
 * Everything else (Importeren, journal, trial balance, Beheer pages, …) stays
 * reachable via ⌘K / existing routes — flip `placement` to put an item back in
 * the rail later without hunting call sites.
 */

export type NavPlacement = 'primary' | 'footer' | 'palette'

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
  /**
   * Where this row appears.
   * - `primary` — the eight flat destinations
   * - `footer` — Settings / Shortcuts under the spacer
   * - `palette` — ⌘K (and help Ga naar) only
   */
  readonly placement: NavPlacement
  /**
   * Extra path prefixes that light this item (e.g. Reports also covers
   * `/entries` and every `/reports/*`).
   */
  readonly alsoActiveFor?: readonly string[]
  /** Footer action that opens the shortcut sheet instead of navigating. */
  readonly openShortcuts?: boolean
}

/** @deprecated Groups are gone; kept as a thin wrapper for older call sites. */
export interface NavGroup {
  readonly key?: MessageKey
  readonly items: readonly NavItem[]
}

/**
 * Single source of truth for destinations.
 *
 * Order of `primary` is the rail order. Re-home Importeren / Journaalposten /
 * Proefbalans by changing `placement` (and optionally `advancedOnly`) only.
 */
export const SHELL_NAV: readonly NavItem[] = [
  // --- Eight flat destinations (export Sidebar) ---------------------------------
  { to: '/', key: 'nav.home', binding: 'go.dashboard', placement: 'primary' },
  { to: '/inbox', key: 'nav.inbox', binding: 'go.inbox', placement: 'primary' },
  { to: '/invoices', key: 'nav.sales', binding: 'go.invoices', placement: 'primary' },
  { to: '/purchases', key: 'nav.costs', binding: 'go.purchases', placement: 'primary' },
  {
    to: '/bank/match',
    key: 'nav.bank',
    binding: 'go.bank',
    placement: 'primary',
    alsoActiveFor: ['/bank'],
  },
  { to: '/vat', key: 'nav.vat', binding: 'go.vat', placement: 'primary' },
  {
    to: '/reports/profit-and-loss',
    key: 'nav.reports',
    binding: 'go.profit',
    placement: 'primary',
    alsoActiveFor: ['/reports', '/entries'],
  },
  { to: '/contacts', key: 'nav.contacts', binding: 'go.contacts', placement: 'primary' },

  // --- Footer --------------------------------------------------------------------
  {
    to: '/settings',
    key: 'nav.settings',
    binding: 'go.settings',
    roles: ['owner', 'accountant', 'bookkeeper'],
    placement: 'footer',
  },
  {
    to: '/',
    key: 'nav.shortcuts',
    binding: 'help',
    placement: 'footer',
    openShortcuts: true,
  },

  // --- Palette / chords only (placement flip restores them to the rail) ----------
  {
    to: '/importeren',
    key: 'nav.import',
    binding: 'go.import',
    roles: ['owner', 'accountant', 'bookkeeper'],
    placement: 'palette',
  },
  {
    to: '/importeren',
    key: 'nav.importMoneybird',
    binding: 'go.moneybird',
    roles: ['owner', 'accountant', 'bookkeeper'],
    search: { bron: 'moneybird' },
    placement: 'palette',
  },
  {
    to: '/importeren',
    key: 'nav.importExact',
    binding: 'go.exact',
    roles: ['owner', 'accountant', 'bookkeeper'],
    search: { bron: 'exact' },
    placement: 'palette',
  },
  {
    to: '/exact',
    key: 'nav.exactAdvanced',
    binding: 'go.exactLegacy',
    roles: ['owner', 'accountant', 'bookkeeper'],
    advancedOnly: true,
    placement: 'palette',
  },
  {
    to: '/entries',
    key: 'nav.entries',
    binding: 'go.journal',
    advancedOnly: true,
    placement: 'palette',
  },
  {
    to: '/reports/trial-balance',
    key: 'nav.trialBalance',
    binding: 'go.trial',
    advancedOnly: true,
    placement: 'palette',
  },
  {
    to: '/accounts',
    key: 'nav.categories',
    advancedKey: 'nav.accounts',
    binding: 'go.accounts',
    placement: 'palette',
  },
  {
    to: '/reports/balance-sheet',
    key: 'nav.balanceSheet',
    binding: 'go.balance',
    placement: 'palette',
  },
  {
    to: '/reports/debtor-ageing',
    key: 'nav.debtorsPlain',
    advancedKey: 'nav.debtorAgeing',
    binding: 'go.debtorAgeing',
    placement: 'palette',
  },
  {
    to: '/reports/creditor-ageing',
    key: 'nav.creditorAgeing',
    binding: 'go.creditorAgeing',
    placement: 'palette',
  },
  {
    to: '/dunning',
    key: 'nav.dunning',
    binding: 'go.dunning',
    placement: 'palette',
  },
  {
    to: '/payments',
    key: 'nav.payments',
    binding: 'go.payments',
    placement: 'palette',
  },
  {
    to: '/bank',
    key: 'nav.bankStatements',
    binding: 'go.bankStatements',
    placement: 'palette',
  },
  {
    to: '/members',
    key: 'nav.members',
    binding: 'go.members',
    roles: ['owner'],
    placement: 'palette',
  },
  {
    to: '/fiscal-years',
    key: 'nav.fiscalYears',
    binding: 'go.fiscalYears',
    roles: MAY_OPEN_YEAR,
    placement: 'palette',
  },
  {
    to: '/tax-codes',
    key: 'nav.taxCodes',
    binding: 'go.taxCodes',
    roles: MAY_MANAGE_TAX_CODES,
    placement: 'palette',
  },
  {
    to: '/audit-file',
    key: 'nav.auditFile',
    binding: 'go.auditFile',
    roles: MAY_EXPORT_AUDIT_FILE,
    placement: 'palette',
  },
  {
    to: '/webhooks',
    key: 'nav.webhooks',
    binding: 'go.webhooks',
    roles: ['owner'],
    placement: 'palette',
  },
  {
    to: '/audit-log',
    key: 'nav.auditLog',
    binding: 'go.audit',
    roles: ['owner', 'accountant', 'auditor'],
    placement: 'palette',
  },
  {
    to: '/retention',
    key: 'nav.retention',
    binding: 'go.retention',
    roles: ['owner', 'accountant', 'auditor'],
    placement: 'palette',
  },
  {
    to: '/snapshots',
    key: 'nav.snapshots',
    binding: 'go.snapshots',
    roles: ['owner', 'accountant', 'auditor', 'bookkeeper'],
    placement: 'palette',
  },
]

/** Rail + Sheet: primary destinations then footer. */
export function sidebarNavItems(role: string, advanced: boolean): readonly NavItem[] {
  return SHELL_NAV.filter((item) => {
    if (item.placement !== 'primary' && item.placement !== 'footer') return false
    if (item.roles !== undefined && !item.roles.includes(role)) return false
    if (item.advancedOnly === true && !advanced) return false
    return true
  })
}

export function sidebarPrimaryItems(role: string, advanced: boolean): readonly NavItem[] {
  return sidebarNavItems(role, advanced).filter((item) => item.placement === 'primary')
}

export function sidebarFooterItems(role: string, advanced: boolean): readonly NavItem[] {
  return sidebarNavItems(role, advanced).filter((item) => item.placement === 'footer')
}

/**
 * Back-compat grouped view for any caller still mapping groups. Phase 0 has no
 * group headings in the rail — one synthetic group of primary items.
 */
export const NAVIGATION: readonly NavGroup[] = [
  { items: SHELL_NAV.filter((item) => item.placement === 'primary') },
  { items: SHELL_NAV.filter((item) => item.placement === 'footer') },
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

function pathMatches(path: string, to: string): boolean {
  if (to === '/') return path === '/'
  return path === to || path.startsWith(`${to}/`)
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
  alsoActiveFor?: readonly string[],
): boolean {
  const prefixes = [to, ...(alsoActiveFor ?? [])]
  const matched = prefixes.some((prefix) => pathMatches(path, prefix))
  if (!matched) return false

  // Another primary/footer destination with a longer/more specific `to` wins.
  const competitors = SHELL_NAV.filter(
    (item) => item.placement === 'primary' || item.placement === 'footer',
  )
  const stolen = competitors.some((other) => {
    if (other.to === to) return false
    if (!pathMatches(path, other.to)) return false
    // Longer path prefix is more specific.
    return other.to.length > to.length
  })
  if (stolen) return false

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
  let best: { to: string; key: MessageKey; specific: number } | null = null
  for (const item of SHELL_NAV) {
    if (item.openShortcuts === true) continue
    if (!isNavActive(path, item.to, currentSearch, item.search, item.alsoActiveFor)) continue
    // Prefer a bron-specific Importeren row over the generic Importeren action.
    const specific = item.search === undefined ? 0 : Object.keys(item.search).length
    if (
      best === null ||
      item.to.length > best.to.length ||
      (item.to.length === best.to.length && specific > best.specific)
    ) {
      best = { to: item.to, key: navLabelKey(item, advanced), specific }
    }
  }
  return best?.key ?? null
}

/**
 * Nav destinations for ⌘K: daily-work order (primary → footer → palette),
 * simple labels when Geavanceerd is off, and advanced-only items last.
 */
export function paletteNavItems(
  role: string,
  advanced: boolean,
): readonly { item: NavItem; groupKey: MessageKey | undefined }[] {
  const primary: { item: NavItem; groupKey: MessageKey | undefined }[] = []
  const deferred: { item: NavItem; groupKey: MessageKey | undefined }[] = []
  for (const item of SHELL_NAV) {
    if (item.binding === undefined) continue
    if (item.openShortcuts === true) continue
    if (item.roles !== undefined && !item.roles.includes(role)) continue
    // Legacy Exact (oud): ⌘K only when Geavanceerd is on (#105 Designer).
    if (!advanced && item.advancedOnly === true && item.binding === 'go.exactLegacy') {
      continue
    }
    const row = { item, groupKey: undefined as MessageKey | undefined }
    if (!advanced && item.advancedOnly === true) deferred.push(row)
    else primary.push(row)
  }
  return advanced ? primary : [...primary, ...deferred]
}

/** Reports tab strip — order is product-locked for Phase 0. */
export interface ReportsTab {
  readonly id: string
  readonly to: string
  readonly key: MessageKey
  readonly digit: number
  readonly advancedOnly?: boolean
}

export const REPORTS_TABS: readonly ReportsTab[] = [
  { id: 'profit', to: '/reports/profit-and-loss', key: 'nav.profitAndLoss', digit: 1 },
  { id: 'balance', to: '/reports/balance-sheet', key: 'nav.balanceSheet', digit: 2 },
  { id: 'debtors', to: '/reports/debtor-ageing', key: 'nav.debtorsPlain', digit: 3 },
  { id: 'creditors', to: '/reports/creditor-ageing', key: 'nav.creditorAgeing', digit: 4 },
  {
    id: 'trial',
    to: '/reports/trial-balance',
    key: 'nav.trialBalance',
    digit: 5,
    advancedOnly: true,
  },
  {
    id: 'journal',
    to: '/entries',
    key: 'nav.entries',
    digit: 6,
    advancedOnly: true,
  },
]

export function visibleReportsTabs(advanced: boolean): readonly ReportsTab[] {
  return REPORTS_TABS.filter((tab) => advanced || tab.advancedOnly !== true)
}
