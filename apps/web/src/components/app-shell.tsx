import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiMenuLine,
  RiMoonLine,
  RiSearchLine,
  RiSunLine,
} from '@remixicon/react'
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
import { DEFAULT_THEME_PREFERENCE, type ThemePreference } from '~/lib/theme'
import { setTheme } from '~/server/theme'
import { BINDINGS_BY_ID, bindingChips, isApple } from '~/lib/keyboard'
import {
  NAVIGATION,
  isNavActive,
  navLabelKey,
  pageTitleKey,
  type NavGroup,
} from '~/lib/shell-nav'
import { CommandPalette } from './command-palette'

/** #63 focus ring: solid outline, never outline-none (Tailwind 4 trap). */
const FOCUS_RING =
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/**
 * The frame every screen sits in.
 *
 * Navigation shows its shortcut next to each item, because a shortcut nobody
 * can see is a shortcut nobody uses (docs/keyboard-map.md) — and the palette
 * mounted here is what makes those keys do something. They were printed in this
 * sidebar from M0 and listened for by nothing until now, which is the worse
 * half of the same problem: a shortcut shown and not implemented is a promise
 * the application breaks the first time somebody believes it.
 *
 * Phone versus desktop chrome is pure CSS (`md:hidden` / `hidden md:flex`) so
 * the first paint on a phone is never the desktop rail (#64 design review).
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

/** Navigation IA lives in `~/lib/shell-nav` (rail, Sheet, and ⌘K share it). */

export interface ShellEntity {
  readonly entityId: string
  readonly entityName: string
  readonly role: string
  /** Fictional trial books (issue #48). */
  readonly isDemo: boolean
}

function roleMessageKey(role: string): MessageKey | null {
  switch (role) {
    case 'owner':
      return 'members.role.owner'
    case 'bookkeeper':
      return 'members.role.bookkeeper'
    case 'accountant':
      return 'members.role.accountant'
    case 'auditor':
      return 'members.role.auditor'
    default:
      return null
  }
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

  const titleKey = pageTitleKey(path, advanced)
  const pageTitle = titleKey !== null ? t(titleKey) : 'Klopt'

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

  const railChrome = (
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
    />
  )

  const sheetChrome = (
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
      onNavigate={() => {
        setNavOpen(false)
      }}
    />
  )

  return (
    <div className="bg-background text-foreground min-h-screen overflow-x-clip">
      <CommandPalette role={role} />
      <a
        href="#main"
        className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:px-3 focus:py-2"
      >
        {t('shell.skipToContent')}
      </a>

      <div className="flex min-h-screen md:min-h-0">
        {/*
          Desktop / tablet rail (≥768). Always mounted; `hidden md:flex` so a
          phone never paints the 256px sidebar on first paint (#64 review #1).
          Yellow is the left bar on the current item only (#57).
        */}
        <nav
          aria-label={t('shell.navigation')}
          className="border-sidebar-border bg-sidebar text-sidebar-foreground sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r md:flex"
        >
          <div className="flex h-12 items-center gap-2 px-4">
            <Link
              to="/"
              className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
            >
              <span
                aria-hidden="true"
                className="bg-accent text-accent-foreground flex size-6 items-center justify-center text-[13px] font-semibold"
              >
                {t('shell.brandMark')}
              </span>
              Klopt
            </Link>
          </div>
          {railChrome}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          {/*
            Phone chrome (#38 / #57): 48 px top bar, menu → left Sheet, page
            title, search, theme. Always mounted; `md:hidden` hides it on desktop.
          */}
          <header className="border-border bg-background sticky top-0 z-40 flex h-12 items-center gap-1 border-b px-1 md:hidden">
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
                      className="bg-accent text-accent-foreground flex size-6 items-center justify-center text-[13px] font-semibold"
                    >
                      {t('shell.brandMark')}
                    </span>
                    Klopt
                  </SheetTitle>
                  <SheetDescription className="sr-only">{t('shell.navigation')}</SheetDescription>
                </SheetHeader>
                <nav aria-label={t('shell.navigation')} className="flex min-h-0 flex-1 flex-col">
                  {sheetChrome}
                </nav>
              </SheetContent>
            </Sheet>
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{pageTitle}</span>
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
            <ThemeToggleButton hydrated={hydrated} />
          </header>

          {/*
            Desktop 48 px top bar: page title, ⌘K search trigger, theme toggle.
          */}
          <header className="border-border bg-background sticky top-0 z-30 hidden h-12 items-center gap-4 border-b px-8 md:flex">
            {/*
              Not an <h1>: every screen already has its own page heading, and a
              second one here makes getByRole('heading', { name }) ambiguous.
            */}
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{pageTitle}</p>
            <button
              type="button"
              disabled={!hydrated}
              onClick={() => {
                window.dispatchEvent(new Event('klopt:open-palette'))
              }}
              className={cn(
                'text-muted-foreground hover:bg-muted flex h-9 w-72 items-center gap-2 border border-input px-3 text-sm disabled:opacity-50',
                FOCUS_RING,
              )}
            >
              <RiSearchLine className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left">{t('shell.searchTrigger')}</span>
              <span className="hidden items-center gap-0.5 sm:inline-flex">
                <Keycap>{isApple() ? '⌘' : 'Ctrl'}</Keycap>
                <Keycap>k</Keycap>
              </span>
            </button>
            <ThemeToggleButton hydrated={hydrated} />
          </header>

          {/*
            Focusable, and focused on every route change (see `useFocusOnRoute`).
            In a single-page application a navigation moves nothing: the old screen
            is replaced and the focus stays on whatever opened it, or lands on
            `<body>` when that element has gone with the screen. Either way the
            next `Tab` starts from the wrong place and a screen reader says
            nothing at all — so the new screen takes the focus, which is what a
            browser does for a real page load.
          */}
          <main
            id="main"
            ref={main}
            tabIndex={-1}
            className="min-w-0 flex-1 scroll-mt-12 p-4 outline-none md:p-8"
          >
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
    </div>
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
      <EntitySwitcher
        entities={entities}
        activeEntityId={activeEntityId}
        onSwitchEntity={onSwitchEntity}
        fiscalYears={fiscalYears}
        activeYear={activeYear}
        onSelectYear={onSelectYear}
        hydrated={hydrated}
      />

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
                const labelKey = navLabelKey(item, advanced)
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
 * One combined Administratie / Boekjaar control (#57 prototype).
 *
 * The closed row shows the administration over the year + date range. Opening
 * it reveals the labelled SelectFields the e2e suite already drives, so
 * `chooseOption(…, 'Administratie' | 'Boekjaar', …)` keeps working.
 */
function EntitySwitcher({
  entities,
  activeEntityId,
  onSwitchEntity,
  fiscalYears,
  activeYear,
  onSelectYear,
  hydrated,
}: {
  entities: readonly ShellEntity[]
  activeEntityId: string
  onSwitchEntity: (entityId: string) => void
  fiscalYears: readonly FiscalYearOption[]
  activeYear: FiscalYearScope | null
  onSelectYear: (code: string) => void
  hydrated: boolean
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const active = entities.find((entity) => entity.entityId === activeEntityId) ?? entities[0]
  if (entities.length === 0 && (fiscalYears.length === 0 || activeYear === null)) return null

  const entityLabel =
    active === undefined
      ? ''
      : active.isDemo
        ? t('shell.demoEntity', { name: active.entityName })
        : active.entityName
  const yearRange =
    activeYear === null
      ? ''
      : t('shell.yearSummary', {
          year: activeYear.code,
          range: `${formatDate(activeYear.startsOn)} – ${formatDate(activeYear.endsOn)}`,
        })

  return (
    <div className="mx-2 mb-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={!hydrated}
          className={cn(
            'border-sidebar-border bg-background flex min-h-11 w-full items-center gap-2 border px-3 py-1.5 text-left md:min-h-0',
            'hover:bg-background/70 data-[state=open]:bg-background',
            FOCUS_RING,
          )}
          aria-label={t('shell.entitySwitcher')}
        >
          <span className="min-w-0 flex-1">
            {entityLabel !== '' && (
              <span className="block truncate text-sm font-medium">{entityLabel}</span>
            )}
            {yearRange !== '' && (
              <span className="text-muted-foreground block truncate text-xs tabular">{yearRange}</span>
            )}
          </span>
          <RiArrowDownSLine aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" sideOffset={4} className="w-64 space-y-3 p-3">
          {entities.length > 0 && (
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
          )}
          {fiscalYears.length > 0 && activeYear !== null && (
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
          )}
        </PopoverContent>
      </Popover>
    </div>
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
  const roleKey = roleMessageKey(role)
  const roleLine =
    roleKey === null
      ? advanced
        ? t('shell.advancedOn')
        : t('shell.advancedOff')
      : `${t(roleKey)} · ${advanced ? t('shell.advancedOn') : t('shell.advancedOff')}`

  return (
    <section aria-label={t('shell.profile')} className="border-sidebar-border border-t p-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={!hydrated}
          className={cn(
            'group flex min-h-11 w-full items-center gap-2 px-2 py-1.5 text-left md:min-h-0',
            'hover:bg-background/70 data-[state=open]:bg-background',
            FOCUS_RING,
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
            <span className="text-muted-foreground block truncate text-xs">{roleLine}</span>
          </span>
          <RiArrowRightSLine
            aria-hidden="true"
            className="text-muted-foreground size-4 shrink-0 -rotate-90"
          />
        </PopoverTrigger>

        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-72 p-0"
          role="dialog"
          aria-label={t('shell.profile')}
        >
          <div className="border-border border-b px-3 py-2">
            <span className="block truncate text-sm font-medium" title={shown}>
              {shown}
            </span>
            <span className="text-muted-foreground block text-xs">{roleLine}</span>
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
            className={cn(
              'hover:bg-muted focus-visible:bg-accent focus-visible:text-accent-foreground flex min-h-14 w-full items-start gap-3 px-3 py-2.5 text-left',
              FOCUS_RING,
            )}
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
              className={cn(
                'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground block min-h-11 w-full px-3 py-2 text-left text-sm md:min-h-0',
                FOCUS_RING,
              )}
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

/** Whether `<html>` currently has `.dark` (for Systeem preference). */
function useHtmlDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
      return () => {
        observer.disconnect()
      }
    },
    () => document.documentElement.classList.contains('dark'),
    () => false,
  )
}

/** Quick light/dark flip for the top bars (#57 prototype). */
function ThemeToggleButton({ hydrated }: { hydrated: boolean }) {
  const { t } = useT()
  const router = useRouter()
  const htmlDark = useHtmlDark()
  const theme = useRouterState({
    select: (state) =>
      (state.matches[0]?.loaderData as { theme?: ThemePreference } | undefined)?.theme,
  })
  const preference = theme ?? DEFAULT_THEME_PREFERENCE
  const darkNow = preference === 'dark' || (preference === 'system' && htmlDark)

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={!hydrated}
      aria-label={darkNow ? t('shell.themeToLight') : t('shell.themeToDark')}
      onClick={() => {
        void setTheme({ data: { theme: darkNow ? 'light' : 'dark' } })
          .then(() => router.invalidate())
          .catch((cause: unknown) => {
            console.error('[app] could not change theme', cause)
          })
      }}
    >
      {darkNow ? <RiSunLine className="size-[18px]" /> : <RiMoonLine className="size-[18px]" />}
    </Button>
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
                'min-h-11 flex-1 px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0',
                FOCUS_RING,
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
