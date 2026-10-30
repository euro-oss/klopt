import type { MessageKey } from '~/i18n/nl'
import { MAY_EXPORT_AUDIT_FILE, MAY_MANAGE_TAX_CODES, MAY_OPEN_YEAR } from './roles'

/**
 * Shell navigation — Phase 0 redesign (#107), Designer v2 IA.
 *
 * One config array drives the rail, the phone Sheet, and ⌘K. v2 groups the
 * rail (Money / Books); Import is pinned in the footer next to Settings.
 * Journal is a top-level Books item with its own SubNav tabs — no Geavanceerd
 * gating on Journal, Import, or Proefbalans.
 */

export type NavPlacement = 'primary' | 'footer' | 'palette'

/** Sidebar section headings (v2). `null` = ungrouped (Home, Inbox). */
export type NavSection = 'money' | 'books' | null

export interface NavItem {
  readonly to: string
  readonly key: MessageKey
  /** Label when Geavanceerd is on; `key` is the simple-mode word. */
  readonly advancedKey?: MessageKey
  readonly binding?: string
  readonly roles?: readonly string[]
  /**
   * Hidden from the rail when Geavanceerd is off; still in ⌘K.
   * Not used for Journal / Import / Proefbalans (v2 — always visible).
   */
  readonly advancedOnly?: boolean
  /** Optional search params (e.g. import wizard `?bron=`). */
  readonly search?: Readonly<Record<string, string>>
  readonly placement: NavPlacement
  /** Primary-rail section (v2 Money / Books). Ignored for footer/palette. */
  readonly section?: NavSection
  /**
   * Extra path prefixes that light this item (e.g. Reports covers every
   * `/reports/*`; Journal covers `/entries` and `/accounts`).
   */
  readonly alsoActiveFor?: readonly string[]
  /** Footer action that opens the shortcut sheet instead of navigating. */
  readonly openShortcuts?: boolean
}

export interface NavGroup {
  readonly key?: MessageKey
  readonly items: readonly NavItem[]
}

/**
 * Single source of truth for destinations.
 *
 * Primary order matches v2 Sidebar.dc.html. Footer: Import, Settings, Shortcuts.
 */
export const SHELL_NAV: readonly NavItem[] = [
  // --- Ungrouped -----------------------------------------------------------------
  { to: '/', key: 'nav.home', binding: 'go.dashboard', placement: 'primary', section: null },
  { to: '/inbox', key: 'nav.inbox', binding: 'go.inbox', placement: 'primary', section: null },

  // --- Money ---------------------------------------------------------------------
  {
    to: '/invoices',
    key: 'nav.sales',
    binding: 'go.invoices',
    placement: 'primary',
    section: 'money',
  },
  {
    to: '/purchases',
    key: 'nav.costs',
    binding: 'go.purchases',
    placement: 'primary',
    section: 'money',
  },
  {
    to: '/bank/match',
    key: 'nav.bank',
    binding: 'go.bank',
    placement: 'primary',
    section: 'money',
    alsoActiveFor: ['/bank'],
  },
  {
    to: '/contacts',
    key: 'nav.contacts',
    binding: 'go.contacts',
    placement: 'primary',
    section: 'money',
  },

  // --- Books ---------------------------------------------------------------------
  {
    to: '/entries',
    key: 'nav.journal',
    binding: 'go.journal',
    placement: 'primary',
    section: 'books',
  },
  { to: '/vat', key: 'nav.vat', binding: 'go.vat', placement: 'primary', section: 'books' },
  {
    to: '/reports/profit-and-loss',
    key: 'nav.reports',
    binding: 'go.profit',
    placement: 'primary',
    section: 'books',
    alsoActiveFor: ['/reports'],
  },

  // --- Footer: Import + Settings + Shortcuts -------------------------------------
  {
    to: '/importeren',
    key: 'nav.import',
    binding: 'go.import',
    roles: ['owner', 'accountant', 'bookkeeper'],
    placement: 'footer',
  },
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

  // --- Palette / chords only -----------------------------------------------------
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
    to: '/reports/trial-balance',
    key: 'nav.trialBalance',
    binding: 'go.trial',
    placement: 'palette',
  },
  // Categories / Ledger per account are [API] (#107) — route stays, but not in
  // the rail or ⌘K until PM scope sign-off.
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

const SECTION_ORDER: readonly (NavSection | undefined)[] = [null, 'money', 'books']

const SECTION_LABEL: Readonly<Record<'money' | 'books', MessageKey>> = {
  money: 'nav.group.money',
  books: 'nav.group.books',
}

function itemVisible(item: NavItem, role: string, advanced: boolean): boolean {
  if (item.roles !== undefined && !item.roles.includes(role)) return false
  if (item.advancedOnly === true && !advanced) return false
  return true
}

export function sidebarNavItems(role: string, advanced: boolean): readonly NavItem[] {
  return SHELL_NAV.filter(
    (item) =>
      (item.placement === 'primary' || item.placement === 'footer') &&
      itemVisible(item, role, advanced),
  )
}

export function sidebarPrimaryItems(role: string, advanced: boolean): readonly NavItem[] {
  return sidebarNavItems(role, advanced).filter((item) => item.placement === 'primary')
}

export function sidebarFooterItems(role: string, advanced: boolean): readonly NavItem[] {
  return sidebarNavItems(role, advanced).filter((item) => item.placement === 'footer')
}

/** Primary rail as v2 sections (ungrouped → Money → Books). */
export function sidebarPrimarySections(
  role: string,
  advanced: boolean,
): readonly { readonly key: MessageKey | undefined; readonly items: readonly NavItem[] }[] {
  const primary = sidebarPrimaryItems(role, advanced)
  const out: { key: MessageKey | undefined; items: NavItem[] }[] = []
  for (const section of SECTION_ORDER) {
    const items = primary.filter((item) => (item.section ?? null) === section)
    if (items.length === 0) continue
    out.push({
      key: section === null || section === undefined ? undefined : SECTION_LABEL[section],
      items,
    })
  }
  return out
}

/** Back-compat grouped view. */
export const NAVIGATION: readonly NavGroup[] = [
  { items: SHELL_NAV.filter((item) => item.placement === 'primary' && item.section == null) },
  {
    key: 'nav.group.money',
    items: SHELL_NAV.filter((item) => item.placement === 'primary' && item.section === 'money'),
  },
  {
    key: 'nav.group.books',
    items: SHELL_NAV.filter((item) => item.placement === 'primary' && item.section === 'books'),
  },
  { items: SHELL_NAV.filter((item) => item.placement === 'footer') },
]

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

  const competitors = SHELL_NAV.filter(
    (item) => item.placement === 'primary' || item.placement === 'footer',
  )
  const stolen = competitors.some((other) => {
    if (other.to === to) return false
    if (!pathMatches(path, other.to)) return false
    return other.to.length > to.length
  })
  if (stolen) return false

  // /reports/* prefers Reports over Journal (trial balance is shared).
  if (to === '/entries' && path.startsWith('/reports/')) return false

  const itemBron = itemSearch?.['bron']
  if (itemBron === undefined) return true
  const currentBron = searchBron(currentSearch) ?? 'moneybird'
  return currentBron === itemBron
}

export function navLabelKey(item: NavItem, advanced: boolean): MessageKey {
  return advanced && item.advancedKey !== undefined ? item.advancedKey : item.key
}

export function pageTitleKey(
  path: string,
  advanced: boolean,
  currentSearch?: NavSearch,
): MessageKey | null {
  let best: { to: string; key: MessageKey; specific: number } | null = null
  for (const item of SHELL_NAV) {
    if (item.openShortcuts === true) continue
    if (!isNavActive(path, item.to, currentSearch, item.search, item.alsoActiveFor)) continue
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
    if (!advanced && item.advancedOnly === true && item.binding === 'go.exactLegacy') {
      continue
    }
    const row = { item, groupKey: undefined as MessageKey | undefined }
    if (!advanced && item.advancedOnly === true) deferred.push(row)
    else primary.push(row)
  }
  return advanced ? primary : [...primary, ...deferred]
}

/** Reports tab strip — v2 order; Proefbalans is tab 5; no Geavanceerd gate. */
export interface ReportsTab {
  readonly id: string
  readonly to: string
  readonly key: MessageKey
  readonly digit: number
}

export const REPORTS_TABS: readonly ReportsTab[] = [
  { id: 'profit', to: '/reports/profit-and-loss', key: 'nav.profitAndLoss', digit: 1 },
  { id: 'balance', to: '/reports/balance-sheet', key: 'nav.balanceSheet', digit: 2 },
  { id: 'debtors', to: '/reports/debtor-ageing', key: 'nav.debtorsPlain', digit: 3 },
  { id: 'creditors', to: '/reports/creditor-ageing', key: 'nav.creditorAgeing', digit: 4 },
  { id: 'trial', to: '/reports/trial-balance', key: 'nav.trialBalance', digit: 5 },
]

export function visibleReportsTabs(_advanced?: boolean): readonly ReportsTab[] {
  return REPORTS_TABS
}

/**
 * Journal tabs (v2): Entries / Trial balance.
 *
 * Ledger per account is [API] (#107) — omitted from the UI (no tab, no
 * placeholder) until PM scope sign-off.
 */
export interface JournalTab {
  readonly id: string
  readonly to: string
  readonly key: MessageKey
  readonly digit: number
  readonly alsoActiveFor?: readonly string[]
}

export const JOURNAL_TABS: readonly JournalTab[] = [
  { id: 'entries', to: '/entries', key: 'nav.entries', digit: 1 },
  { id: 'trial', to: '/reports/trial-balance', key: 'nav.trialBalance', digit: 2 },
]

export function visibleJournalTabs(): readonly JournalTab[] {
  return JOURNAL_TABS
}

/**
 * v2 PhoneTabBar — five destinations at 390px (#107 Phase 0).
 *
 * Home · Sales · Inbox · Bank · More. Receipt/More *contents* wait on Batch 3;
 * until then More opens the existing #38 Sheet, and Inbox is the upload entry
 * (no copy that promises reading a photo).
 */
export type PhoneTabId = 'home' | 'sales' | 'inbox' | 'bank' | 'more'

export interface PhoneTab {
  readonly id: PhoneTabId
  readonly key: MessageKey
  readonly to: string
  readonly alsoActiveFor?: readonly string[]
  readonly opensMore?: boolean
}

export const PHONE_TAB_BAR: readonly PhoneTab[] = [
  { id: 'home', key: 'nav.home', to: '/' },
  { id: 'sales', key: 'nav.sales', to: '/invoices' },
  { id: 'inbox', key: 'nav.inbox', to: '/inbox' },
  {
    id: 'bank',
    key: 'nav.bank',
    to: '/bank/match',
    alsoActiveFor: ['/bank'],
  },
  { id: 'more', key: 'nav.phoneMore', to: '/', opensMore: true },
]

/** Settings SubNav areas (v2) — existing routes; hub grows in Phase 10. */
export interface SettingsNavItem {
  readonly id: string
  readonly to: string
  readonly key: MessageKey
  readonly match?: readonly string[]
}

export const SETTINGS_SUBNAV: readonly SettingsNavItem[] = [
  { id: 'company', to: '/settings', key: 'settings.hubCompany' },
  {
    id: 'books',
    to: '/fiscal-years',
    key: 'settings.hubBooks',
    // Categories (/accounts) are [API] for add/rename — not linked from SubNav.
    match: ['/fiscal-years', '/tax-codes'],
  },
  { id: 'access', to: '/members', key: 'settings.hubAccess', match: ['/members'] },
  {
    id: 'data',
    to: '/importeren',
    key: 'settings.hubData',
    match: ['/importeren', '/audit-file', '/exact'],
  },
]

export function isSettingsNavActive(path: string, item: SettingsNavItem): boolean {
  const prefixes = item.match ?? [item.to]
  return prefixes.some((prefix) => {
    if (prefix === '/settings') return path === '/settings'
    return path === prefix || path.startsWith(`${prefix}/`)
  })
}
