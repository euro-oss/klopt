import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { RiArrowRightSLine, RiMenuLine, RiSearchLine } from '@remixicon/react'
import { Button } from '~/components/ui/button'
import { Keycap } from '~/components/ui/keycap'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '~/components/ui/sheet'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { setLocale } from '~/server/locale'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useAdvancedMode } from '~/lib/advanced-mode-context'
import { useHydrated } from '~/lib/hydration'
import { cn } from '~/lib/utils'
import { formatDate } from '~/lib/format'
import type { FiscalYearOption, FiscalYearScope } from '~/lib/fiscal-year'
import { MAY_EXPORT_AUDIT_FILE, MAY_OPEN_YEAR } from '~/lib/roles'
import { DEFAULT_THEME_PREFERENCE, type ThemePreference } from '~/lib/theme'
import { setTheme } from '~/server/theme'
import { BINDINGS_BY_ID, bindingChips } from '~/lib/keyboard'
import { CommandPalette } from './command-palette'

/**
 * The frame every screen sits in.
 *
 * Navigation shows its shortcut next to each item, because a shortcut nobody
 * can see is a shortcut nobody uses (docs/keyboard-map.md) — and the palette
 * mounted here is what makes those keys do something. They were printed in this
 * sidebar from M0 and listened for by nothing until now, which is the worse
 * half of the same problem: a shortcut shown and not implemented is a promise
 * the application breaks the first time somebody believes it.
 */

/**
 * Move the focus onto the screen that just opened.
 *
 * Not on the first render: the focus is wherever the page put it, which on a
 * form screen is the first field, and dragging it to the heading would undo
 * that. Only when the path changes, which is the moment a real page load would
 * have reset it — and the moment a dialog or a row that had the focus stops
 * existing, leaving it on `<body>` with `Tab` starting over from the top.
 */
function useFocusOnRoute(path: string): React.RefObject<HTMLElement | null> {
  const main = useRef<HTMLElement | null>(null)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    main.current?.focus()
  }, [path])

  return main
}

/**
 * The sidebar, in groups.
 *
 * Daily work first (#61 slice 2 / #57): Verkoop, Inkoop, Geld, then
 * Boekhouden, Rapporten, Importeren, Beheer. Dashboard sits above the groups,
 * ungrouped, because it is the way back.
 *
 * `advancedOnly` items (Journaalposten, Proefbalans) leave the nav when
 * Geavanceerd is off (#44) but stay in ⌘K. `advancedKey` swaps the plain-language
 * label for the ledger term when Geavanceerd is on.
 *
 * `roles` marks a destination not everybody may open, so the nav does not
 * offer a screen that answers 403. A group whose every item is filtered out
 * disappears with them, header and all.
 */
interface NavItem {
  readonly to: string
  readonly key: MessageKey
  /** Label when Geavanceerd is on; `key` is the simple-mode word. */
  readonly advancedKey?: MessageKey
  readonly binding?: string
  readonly roles?: readonly string[]
  /** Hidden from the nav when Geavanceerd is off; still in ⌘K. */
  readonly advancedOnly?: boolean
}

interface NavGroup {
  /** Absent for the opening group, which needs no heading to be understood. */
  readonly key?: MessageKey
  readonly items: readonly NavItem[]
}

const NAVIGATION: readonly NavGroup[] = [
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
        to: '/exact',
        key: 'nav.exact',
        binding: 'go.exact',
        roles: ['owner', 'accountant', 'bookkeeper'],
      },
      {
        to: '/moneybird',
        key: 'nav.moneybird',
        binding: 'go.moneybird',
        roles: ['owner', 'accountant', 'bookkeeper'],
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
        to: '/audit-file',
        key: 'nav.auditFile',
        binding: 'go.auditFile',
        roles: MAY_EXPORT_AUDIT_FILE,
      },
      { to: '/webhooks', key: 'nav.webhooks', binding: 'go.webhooks', roles: ['owner'] },
      {
        to: '/audit-log',
        key: 'nav.auditLog',
        binding: 'go.audit',
        roles: ['owner', 'accountant', 'auditor'],
      },
      {
        to: '/retention',
        key: 'nav.retention',
        binding: 'go.retention',
        roles: ['owner', 'accountant', 'auditor'],
      },
      {
        to: '/snapshots',
        key: 'nav.snapshots',
        binding: 'go.snapshots',
        roles: ['owner', 'accountant', 'auditor', 'bookkeeper'],
      },
    ],
  },
]

export interface ShellEntity {
  readonly entityId: string
  readonly entityName: string
  readonly role: string
  /** Fictional trial books (issue #48). */
  readonly isDemo: boolean
}

export function AppShell({
  children,
  entities,
  activeEntityId,
  userName,
  userEmail,
  onSwitchEntity,
  fiscalYears,
  activeYear,
  onSelectYear,
}: {
  children: ReactNode
  entities: readonly ShellEntity[]
  activeEntityId: string | null
  userName: string
  userEmail: string
  onSwitchEntity: (entityId: string) => void
  fiscalYears: readonly FiscalYearOption[]
  activeYear: FiscalYearScope | null
  onSelectYear: (code: string) => void
}) {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const main = useFocusOnRoute(path)
  // The keys are listened for in an effect, so they do nothing until React has
  // taken over. Advertising them before then is the same broken promise as
  // advertising them with no listener at all, only shorter — so the hint
  // appears exactly when the key starts working.
  const shortcutsLive = useHydrated()
  const hydrated = useHydrated()
  const { t } = useT()
  const { advanced } = useAdvancedMode()
  const active = entities.find((entity) => entity.entityId === activeEntityId) ?? entities[0]
  const role = active?.role ?? ''
  // Phone Sheet (<768). Closed from the link click itself so a destination
  // does not leave the drawer covering the screen it just opened (#38).
  const [navOpen, setNavOpen] = useState(false)
  // One chrome instance only: mounting the rail and the Sheet together would
  // duplicate SelectField ids the moment the drawer opened. SSR assumes the
  // desktop rail; the phone top bar mounts once the media query says so.
  const phone = usePhoneViewport()

  // Role filter, then Geavanceerd: Journaalposten / Proefbalans leave the nav
  // when the toggle is off but stay in ⌘K (#44). Empty groups drop out.
  const groups = NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (item.roles === undefined || item.roles.includes(role)) &&
        (item.advancedOnly !== true || advanced),
    ),
  })).filter((group) => group.items.length > 0)

  const chrome = (
    <ShellNavChrome
      path={path}
      groups={groups}
      advanced={advanced}
      entities={entities}
      activeEntityId={active?.entityId ?? ''}
      onSwitchEntity={onSwitchEntity}
      fiscalYears={fiscalYears}
      activeYear={activeYear}
      onSelectYear={onSelectYear}
      userName={userName}
      userEmail={userEmail}
      role={role}
      shortcutsLive={shortcutsLive}
      hydrated={hydrated}
      onNavigate={phone ? () => setNavOpen(false) : undefined}
    />
  )

  return (
    <div className="bg-background text-foreground min-h-screen overflow-x-clip">
      <CommandPalette />
      <a
        href="#main"
        className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:px-3 focus:py-2"
      >
        {t('shell.skipToContent')}
      </a>

      {/*
        Phone chrome (#38 / #57): 48 px top bar, menu → left Sheet, search opens
        ⌘K. Destinations are the same list as the desktop rail. No bottom tab bar.
      */}
      {phone && (
        <header className="border-border bg-background sticky top-0 z-40 flex h-12 items-center gap-1 border-b px-1">
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={!hydrated}
                aria-label={t('shell.openMenu')}
                aria-expanded={navOpen}
              >
                <RiMenuLine />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="bg-sidebar text-sidebar-foreground w-72 max-w-[85vw] p-0"
              closeLabel={t('common.close')}
            >
              <SheetHeader className="border-sidebar-border border-b p-3 pr-12">
                <SheetTitle className="flex items-center gap-2 text-left text-[15px] font-semibold tracking-tight normal-case">
                  <span
                    aria-hidden="true"
                    className="bg-accent text-accent-foreground flex size-6 items-center justify-center text-[13px] font-bold"
                  >
                    {t('shell.brandMark')}
                  </span>
                  Klopt
                </SheetTitle>
                <SheetDescription className="sr-only">{t('shell.navigation')}</SheetDescription>
              </SheetHeader>
              <nav aria-label={t('shell.navigation')} className="flex min-h-0 flex-1 flex-col">
                {chrome}
              </nav>
            </SheetContent>
          </Sheet>
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium">Klopt</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={!hydrated}
            aria-label={t('palette.search')}
            onClick={() => {
              window.dispatchEvent(new Event('klopt:open-palette'))
            }}
          >
            <RiSearchLine className="size-[18px]" />
          </Button>
        </header>
      )}

      <div className="flex min-h-screen md:min-h-0">
        {/*
          Desktop / tablet rail (≥768). Yellow is the left bar on the current
          item only — never a large fill (#57). Profile stays at the bottom.
        */}
        {!phone && (
          <nav
            aria-label={t('shell.navigation')}
            className="border-sidebar-border bg-sidebar text-sidebar-foreground sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r"
          >
            <div className="flex h-12 items-center gap-2 px-4">
              <Link
                to="/"
                className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
              >
                <span
                  aria-hidden="true"
                  className="bg-accent text-accent-foreground flex size-6 items-center justify-center text-[13px] font-bold"
                >
                  {t('shell.brandMark')}
                </span>
                Klopt
              </Link>
            </div>
            {chrome}
          </nav>
        )}

        {/*
          Focusable, and focused on every route change (see `useFocusOnRoute`).
          In a single-page application a navigation moves nothing: the old screen
          is replaced and the focus stays on whatever opened it, or lands on
          `<body>` when that element has gone with the screen. Either way the
          next `Tab` starts from the wrong place and a screen reader says
          nothing at all — so the new screen takes the focus, which is what a
          browser does for a real page load.
        */}
        <main id="main" ref={main} tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none md:p-8">
          {active?.isDemo === true && (
            <div
              role="status"
              className="border-border bg-muted text-foreground mb-4 border px-3 py-2 text-sm"
            >
              {t('shell.demoBanner')}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  )
}

/** `true` below 768px. SSR and the first client paint assume the desktop rail. */
function usePhoneViewport(): boolean {
  return useSyncExternalStore(
    subscribePhoneViewport,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  )
}

const PHONE_QUERY = '(max-width: 767px)'

function subscribePhoneViewport(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE_QUERY)
  query.addEventListener('change', onChange)
  return () => {
    query.removeEventListener('change', onChange)
  }
}

/** Prefer the longest matching destination so `/bank` does not steal `/bank/match`. */
function isNavActive(path: string, to: string): boolean {
  if (to === '/') return path === '/'
  if (path !== to && !path.startsWith(`${to}/`)) return false
  const destinations = NAVIGATION.flatMap((group) => group.items.map((item) => item.to))
  return !destinations.some(
    (other) =>
      other !== to &&
      other.startsWith(`${to}/`) &&
      (path === other || path.startsWith(`${other}/`)),
  )
}

/**
 * The shared body of the side-nav and the phone Sheet.
 *
 * One list, two hosts: the desktop rail shows the brand above this block, the
 * Sheet puts it in the dialog title. Keeping the destinations here is what
 * stops Importeren (and every other group) from existing in only one surface.
 */
function ShellNavChrome({
  path,
  groups,
  advanced,
  entities,
  activeEntityId,
  onSwitchEntity,
  fiscalYears,
  activeYear,
  onSelectYear,
  userName,
  userEmail,
  role,
  shortcutsLive,
  hydrated,
  onNavigate,
}: {
  path: string
  groups: readonly NavGroup[]
  advanced: boolean
  entities: readonly ShellEntity[]
  activeEntityId: string
  onSwitchEntity: (entityId: string) => void
  fiscalYears: readonly FiscalYearOption[]
  activeYear: FiscalYearScope | null
  onSelectYear: (code: string) => void
  userName: string
  userEmail: string
  role: string
  shortcutsLive: boolean
  hydrated: boolean
  /** Phone Sheet: dismiss the drawer as soon as a destination is chosen. */
  onNavigate?: (() => void) | undefined
}) {
  const { t } = useT()

  return (
    <>
      {entities.length > 0 && (
        <div className="mx-2 mb-2">
          <SelectField
            label={t('shell.administration')}
            value={activeEntityId}
            onValueChange={onSwitchEntity}
            disabled={!hydrated}
            size="sm"
          >
            {entities.map((entity) => (
              <SelectOption key={entity.entityId} value={entity.entityId}>
                {entity.isDemo
                  ? t('shell.demoEntity', { name: entity.entityName })
                  : entity.entityName}
              </SelectOption>
            ))}
          </SelectField>
        </div>
      )}

      {/*
        The book year, next to the administration and above everything it
        scopes. One control for the whole application rather than a picker per
        report. The dates under it are the point of it.
      */}
      {fiscalYears.length > 0 && activeYear !== null && (
        <div className="mx-2 mb-2">
          <SelectField
            label={t('shell.fiscalYear')}
            value={activeYear.code}
            onValueChange={onSelectYear}
            disabled={!hydrated}
            size="sm"
          >
            {fiscalYears.map((year) => (
              <SelectOption key={year.code} value={year.code}>
                {year.status === 'closed' ? t('shell.yearClosed', { year: year.code }) : year.code}
              </SelectOption>
            ))}
          </SelectField>
          <p className="text-muted-foreground mt-1 text-xs tabular">
            {formatDate(activeYear.startsOn)} – {formatDate(activeYear.endsOn)}
          </p>
        </div>
      )}

      {/* Nieuwe journaalpost is a Geavanceerd action; Eigenaar finds invoices
          on the dashboard instead (#44 / #57). */}
      {advanced && (
        <div className="mx-2 mb-2">
          <Link
            to="/entries/new"
            onClick={onNavigate}
            className="touch-cta touch-cta-primary w-full text-center text-sm"
          >
            {t('shell.newEntry')}
          </Link>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.map((group, index) => (
          <div key={group.key ?? 'start'} className={cn(index > 0 ? 'mt-2' : 'mt-0.5')}>
            {group.key !== undefined && (
              <p className="text-muted-foreground px-3 pb-0.5 text-[11px] font-medium tracking-wide uppercase">
                {t(group.key)}
              </p>
            )}
            <ul role="list">
              {group.items.map((item) => {
                const binding =
                  item.binding === undefined ? undefined : BINDINGS_BY_ID.get(item.binding)
                const isActive = isNavActive(path, item.to)
                const labelKey =
                  advanced && item.advancedKey !== undefined ? item.advancedKey : item.key
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2 border-l-[3px] px-3 text-sm',
                        'min-h-11 md:h-7 md:min-h-0',
                        isActive
                          ? 'border-accent bg-background font-medium'
                          : 'text-sidebar-foreground/85 border-transparent hover:bg-background/70',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
                      {binding !== undefined && shortcutsLive && (
                        // Printed keycaps on desktop only (#57): a phone has
                        // no chord keyboard, and crowding the Sheet helps nobody.
                        <span className="hidden items-center gap-0.5 md:inline-flex">
                          {bindingChips(binding).map((chip, position) => (
                            <Keycap key={`${item.to}-${String(position)}`}>{chip}</Keycap>
                          ))}
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <Profile userName={userName} userEmail={userEmail} role={role} />
    </>
  )
}

/**
 * Who you are, at the bottom of the sidebar — one row of it.
 *
 * The block used to print everything it had: an avatar, a name, a role, a
 * language picker, a theme picker and a sign-out link, five controls stacked
 * against the bottom of a rail that already carries twenty destinations. Only
 * one of them answers a question anybody asks daily ("whose books am I in"),
 * and the other four are settled once and then sit there being read every time
 * the eye reaches the end of the navigation. So the row is now the answer —
 * initial, name, chevron — and the four settings are behind it.
 *
 * The menu opens *upward*, because the trigger is the last thing on the screen
 * and a panel below it would be off the bottom of the viewport.
 *
 * The language picker is in this menu rather than in Instellingen, which is
 * the one thing that got harder and is still the right place: somebody who has
 * landed in the wrong language cannot read the word for "language" to go and
 * find it, so it lives where the eye already goes for account things, one
 * click in, labelled in both languages.
 */
function Profile({
  userName,
  userEmail,
  role,
}: {
  userName: string
  userEmail: string
  role: string
}) {
  const { t } = useT()
  const { advanced, setAdvanced } = useAdvancedMode()
  // A trigger that opens nothing is the failure `select.tsx` describes: this
  // is a Radix popover, so it does nothing at all until React has attached.
  const hydrated = useHydrated()
  const [open, setOpen] = useState(false)

  // Signing in never asks for a name — it is an address and a code — so for
  // most people `name` is empty and the address is the only thing they would
  // recognise as themselves.
  const shown = userName.trim() === '' ? userEmail : userName

  return (
    <section aria-label={t('shell.profile')} className="border-sidebar-border border-t p-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={!hydrated}
          className={cn(
            'group flex min-h-11 w-full items-center gap-2 px-2 py-1.5 text-left outline-none md:min-h-0',
            'hover:bg-background/70 data-[state=open]:bg-background',
          )}
        >
          <span
            aria-hidden="true"
            className="bg-foreground text-background flex size-7 shrink-0 items-center justify-center text-xs font-semibold"
          >
            {initialOf(shown)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium" title={shown}>
              {shown}
            </span>
            <span className="text-muted-foreground block truncate text-xs">
              {role !== '' ? `${t('shell.role', { role })} · ` : ''}
              {advanced ? t('shell.advancedOn') : t('shell.advancedOff')}
            </span>
          </span>
          <RiArrowRightSLine
            aria-hidden="true"
            className="text-muted-foreground size-4 shrink-0 -rotate-90"
          />
        </PopoverTrigger>

        <PopoverContent side="top" align="start" sideOffset={8} className="w-72 p-0">
          <div className="border-border border-b px-3 py-2">
            <span className="block truncate text-sm font-medium" title={shown}>
              {shown}
            </span>
            {role !== '' && (
              <span className="text-muted-foreground block text-xs">
                {t('shell.role', { role })}
              </span>
            )}
          </div>

          {/* Geavanceerd (#44): no shortcut — Shift+letter is table type-ahead. */}
          <button
            type="button"
            role="switch"
            aria-checked={advanced}
            disabled={!hydrated}
            onClick={() => {
              setAdvanced(!advanced)
            }}
            className="hover:bg-muted focus-visible:bg-accent focus-visible:text-accent-foreground flex min-h-14 w-full items-start gap-3 px-3 py-2.5 text-left outline-none"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{t('shell.advanced')}</span>
              <span className="block text-xs opacity-70">{t('shell.advancedHint')}</span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex h-6 w-10 shrink-0 items-center border px-0.5 transition-colors',
                advanced
                  ? 'border-foreground bg-foreground justify-end'
                  : 'border-input justify-start',
              )}
            >
              <span className={cn('size-4', advanced ? 'bg-background' : 'bg-muted-foreground')} />
            </span>
          </button>

          <div className="border-border space-y-3 border-t px-3 py-3">
            <LanguagePicker />
            <ThemePicker />
          </div>

          <form method="post" action="/sign-out" className="border-border border-t">
            <button
              type="submit"
              className="hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground block w-full px-3 py-2 text-left text-sm outline-none"
            >
              {t('shell.account.signOut')}
            </button>
          </form>
        </PopoverContent>
      </Popover>
    </section>
  )
}

/**
 * One letter for the avatar.
 *
 * `Array.from` rather than `[0]`: a name beginning with an emoji or a letter
 * outside the basic plane is two code units, and half a character is not an
 * initial. Falls back to nothing rather than to a placeholder glyph, because
 * an empty circle reads as "no name" and `?` reads as an error.
 */
function initialOf(name: string): string {
  return (Array.from(name.trim())[0] ?? '').toUpperCase()
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  // Explicit `| undefined` rather than `?`: with exactOptionalPropertyTypes,
  // a caller passing a computed `string | undefined` is not assignable to `?`.
  // React props are exactly the case that rule is unhelpful for.
  description?: string | undefined
  actions?: ReactNode | undefined
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && (
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: ReactNode
  hint?: string | undefined
  // `muted` is for a figure that is absent rather than bad: "not read" is not
  // "does not balance", and rendering the two the same reports a gap in our
  // access as a defect in the data.
  //
  // `warn` is "somebody should look at this" and `bad` is "this is money
  // nobody has been paid". They are different colours because they are
  // different sentences, and neither is the accent: a figure in the colour of
  // the primary button is a figure that reads as a suggestion.
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'muted' | undefined
}) {
  return (
    <div className="border-border rounded-md border p-4">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular',
          tone === 'good' && 'text-foreground',
          tone === 'warn' && 'text-unreconciled',
          tone === 'bad' && 'text-destructive',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </p>
      {hint !== undefined && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </div>
  )
}

/**
 * Changing the language.
 *
 * Short rows — NL | EN — rather than a bilingual SelectField. The menu is
 * already one click in; a second click into a listbox for a two-option choice
 * is a click too many, and "Taal / Language" / "Nederlands" was the wall of
 * chrome this block was built to get rid of.
 *
 * Still findable in the wrong language: the label is the short word for
 * "language" in the current locale, and the options are the language codes
 * themselves, which do not need translating.
 */
function LanguagePicker() {
  const { locale, t } = useT()
  const router = useRouter()
  const hydrated = useHydrated()

  return (
    <ChoiceRow
      label={t('language.label')}
      value={locale}
      disabled={!hydrated}
      options={[
        { value: 'nl', label: t('language.nl') },
        { value: 'en', label: t('language.en') },
      ]}
      onChange={(chosen) => {
        void setLocale({ data: { locale: chosen } })
          // The whole tree re-renders from the root loader, which is where the
          // language is resolved — so no reload, and no flash of the language
          // somebody has just left.
          .then(() => router.invalidate())
          .catch((cause: unknown) => {
            console.error('[app] could not change language', cause)
          })
      }}
    />
  )
}

/**
 * Licht, Donker, or Systeem.
 *
 * Beside the language, because both are "how this looks to me" rather than
 * anything about the books. The preference is a cookie; light and dark paint
 * from the server, and Systeem is settled by a boot script in `<head>` so a
 * dark OS does not flash white on the way in.
 */
function ThemePicker() {
  const { t } = useT()
  const router = useRouter()
  const hydrated = useHydrated()
  const theme = useRouterState({
    select: (state) =>
      (state.matches[0]?.loaderData as { theme?: ThemePreference } | undefined)?.theme,
  })

  return (
    <ChoiceRow
      label={t('theme.label')}
      value={theme ?? DEFAULT_THEME_PREFERENCE}
      disabled={!hydrated}
      options={[
        { value: 'light', label: t('theme.light') },
        { value: 'dark', label: t('theme.dark') },
        { value: 'system', label: t('theme.system'), title: t('theme.systemHint') },
      ]}
      onChange={(chosen) => {
        void setTheme({ data: { theme: chosen } })
          .then(() => router.invalidate())
          .catch((cause: unknown) => {
            console.error('[app] could not change theme', cause)
          })
      }}
    />
  )
}

/**
 * A short row of mutually exclusive choices.
 *
 * Used for the two preferences in the account menu. A SelectField would open a
 * listbox for a two- or three-option pick that already fits on one line, and
 * the selected option takes the accent yellow fill — the same signal the open
 * chip uses — rather than a black focus ring that disappears on white.
 */
function ChoiceRow({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: string
  options: readonly { value: string; label: string; title?: string }[]
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <div role="group" aria-label={label}>
      <div className="text-muted-foreground mb-1 text-xs font-medium">{label}</div>
      <div className="border-border flex border">
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              title={option.title}
              onClick={() => {
                if (!selected) onChange(option.value)
              }}
              className={cn(
                'flex-1 px-2 py-1.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50',
                selected
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/60 focus-visible:bg-accent focus-visible:text-accent-foreground',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
