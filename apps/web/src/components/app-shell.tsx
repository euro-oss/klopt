import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { RiArrowRightSLine } from '@remixicon/react'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { setLocale } from '~/server/locale'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useHydrated } from '~/lib/hydration'
import { cn } from '~/lib/utils'
import { formatDate } from '~/lib/format'
import type { FiscalYearOption, FiscalYearScope } from '~/lib/fiscal-year'
import { MAY_EXPORT_AUDIT_FILE, MAY_OPEN_YEAR } from '~/lib/roles'
import { DEFAULT_THEME_PREFERENCE, type ThemePreference } from '~/lib/theme'
import { setTheme } from '~/server/theme'
import { BINDINGS_BY_ID, formatBinding } from '~/lib/keyboard'
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
 * Twenty destinations in one flat list is a list nobody reads; they scan it
 * once, learn where three things are and use the palette for the rest. The
 * groups are the ones a bookkeeper already has in their head — the books
 * themselves, then the two sides of trade, then the money, then what you hand
 * to somebody else.
 *
 * Dashboard sits above the groups, ungrouped, because it is the way back.
 *
 * `roles` marks a destination not everybody may open, so the nav does not
 * offer a screen that answers 403. The list mirrors the permission the
 * operation behind it requires — settings needs `ledger:configure`, membership
 * needs `members:manage`. A group whose every item is filtered out disappears
 * with them, header and all.
 */
interface NavItem {
  readonly to: string
  readonly key: MessageKey
  readonly binding: string
  readonly roles?: readonly string[]
}

interface NavGroup {
  /** Absent for the opening group, which needs no heading to be understood. */
  readonly key?: MessageKey
  readonly items: readonly NavItem[]
}

const NAVIGATION: readonly NavGroup[] = [
  { items: [{ to: '/', key: 'nav.dashboard', binding: 'go.dashboard' }] },
  {
    key: 'nav.group.books',
    items: [
      { to: '/entries', key: 'nav.entries', binding: 'go.journal' },
      { to: '/accounts', key: 'nav.accounts', binding: 'go.accounts' },
      { to: '/vat', key: 'nav.vat', binding: 'go.vat' },
    ],
  },
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
      { to: '/payments', key: 'nav.payments', binding: 'go.payments' },
    ],
  },
  // Ouderdomsanalyse is its own group rather than a line under Rapportages.
  // Who owes us and who we owe is a daily question — it is the one an
  // accountant asks before any statement — and the creditor screen spent M4
  // reachable only from a button on Inkoopfacturen, which is to say: from
  // nowhere, unless you already knew.
  {
    key: 'nav.group.ageing',
    items: [
      { to: '/reports/debtor-ageing', key: 'nav.debtorAgeing', binding: 'go.debtorAgeing' },
      { to: '/reports/creditor-ageing', key: 'nav.creditorAgeing', binding: 'go.creditorAgeing' },
    ],
  },
  {
    key: 'nav.group.reports',
    items: [
      { to: '/reports/trial-balance', key: 'nav.trialBalance', binding: 'go.trial' },
      { to: '/reports/balance-sheet', key: 'nav.balanceSheet', binding: 'go.balance' },
      { to: '/reports/profit-and-loss', key: 'nav.profitAndLoss', binding: 'go.profit' },
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
      // The **looser** of the screen's two permissions, not the stricter one.
      // Closing needs `ledger:close` and opening the next year needs
      // `ledger:configure`, which the bookkeeper holds as well — and a
      // bookkeeper who cannot reach this screen cannot post into a rolled-over
      // year without operator help, which is the sentence #6 exists because of.
      // The screen withholds the close panel from them and says why.
      {
        to: '/fiscal-years',
        key: 'nav.fiscalYears',
        binding: 'go.fiscalYears',
        roles: MAY_OPEN_YEAR,
      },
      // Same shape: `ledger:export` reads one out and `ledger:import` reads one
      // back in. Everybody who may read the books may take them with them, and
      // the screen withholds the import half from the two roles that may not.
      {
        to: '/audit-file',
        key: 'nav.auditFile',
        binding: 'go.auditFile',
        roles: MAY_EXPORT_AUDIT_FILE,
      },
      // `tokens:manage`, like the tokens it sits beside: a webhook is a
      // standing grant of information to a third party.
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
      // Connecting needs `ledger:configure`; the dry run needs `ledger:import`.
      // An auditor holds neither, so the nav does not offer them a 403.
      {
        to: '/exact',
        key: 'nav.exact',
        binding: 'go.exact',
        roles: ['owner', 'accountant', 'bookkeeper'],
      },
    ],
  },
]

export interface ShellEntity {
  readonly entityId: string
  readonly entityName: string
  readonly role: string
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
  const active = entities.find((entity) => entity.entityId === activeEntityId) ?? entities[0]
  const role = active?.role ?? ''

  // A group with nothing left in it loses its heading too, rather than leaving
  // "Beheer" standing over empty space for an auditor.
  const groups = NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles === undefined || item.roles.includes(role)),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="bg-background text-foreground min-h-screen">
      <CommandPalette />
      <a
        href="#main"
        className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:px-3 focus:py-2"
      >
        {t('shell.skipToContent')}
      </a>

      <div className="flex min-h-screen">
        {/*
          A column that fills the viewport and stays put, so the profile block
          is at the bottom of the screen rather than the bottom of a list that
          scrolls away. Only the navigation scrolls; the administration above it
          and the profile below it are always reachable.
        */}
        <nav
          aria-label={t('shell.navigation')}
          className="border-border sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r"
        >
          <div className="px-3 pb-2">
            <Link to="/" className="text-lg font-semibold tracking-tight">
              Klopt
            </Link>
            <p className="text-muted-foreground text-xs">{t('shell.tagline')}</p>
          </div>

          {entities.length > 0 && (
            <div className="px-3 pb-2">
              <SelectField
                label={t('shell.administration')}
                value={active?.entityId ?? ''}
                onValueChange={onSwitchEntity}
                disabled={!hydrated}
                size="sm"
              >
                {entities.map((entity) => (
                  <SelectOption key={entity.entityId} value={entity.entityId}>
                    {entity.entityName}
                  </SelectOption>
                ))}
              </SelectField>
            </div>
          )}

          {/*
            The book year, next to the administration and above everything it
            scopes.

            One control for the whole application rather than a picker per
            report: "which year am I looking at" is a property of the session,
            not of the screen, and a bookkeeper who set 2025 on the proefbalans
            and then opened the balans to find 2026 has been told something
            untrue by the software twice.

            The dates under it are the point of it. A boekjaar labelled 2025
            may run from July 2025 to June 2026, and a year picker that shows
            only the label is the same guess as before with a dropdown on it.
          */}
          {fiscalYears.length > 0 && activeYear !== null && (
            <div className="px-3 pb-2">
              <SelectField
                label={t('shell.fiscalYear')}
                value={activeYear.code}
                onValueChange={onSelectYear}
                disabled={!hydrated}
                size="sm"
              >
                {fiscalYears.map((year) => (
                  <SelectOption key={year.code} value={year.code}>
                    {year.status === 'closed'
                      ? t('shell.yearClosed', { year: year.code })
                      : year.code}
                  </SelectOption>
                ))}
              </SelectField>
              <p className="text-muted-foreground mt-1 text-xs tabular">
                {formatDate(activeYear.startsOn)} – {formatDate(activeYear.endsOn)}
              </p>
            </div>
          )}

          {/* Above the scrolling list, not below it: the commonest action in
              the application should never be behind a scroll. */}
          <div className="px-3 pb-2">
            <Link
              to="/entries/new"
              className="bg-primary text-primary-foreground hover:bg-primary/90 block rounded-md px-3 py-2 text-center text-sm font-medium"
            >
              {t('shell.newEntry')}
            </Link>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {groups.map((group, index) => (
              <div key={group.key ?? 'start'} className={cn(index > 0 && 'mt-5')}>
                {group.key !== undefined && (
                  <h2 className="text-muted-foreground mb-1 px-2 text-[11px] font-semibold tracking-wide uppercase">
                    {t(group.key)}
                  </h2>
                )}
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const binding = BINDINGS_BY_ID.get(item.binding)
                    const isActive = item.to === '/' ? path === '/' : path.startsWith(item.to)
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          className={cn(
                            'group flex items-center justify-between rounded-md px-2 py-1.5 text-sm',
                            isActive
                              ? 'bg-accent text-accent-foreground font-medium'
                              : 'hover:bg-accent/60',
                          )}
                        >
                          {t(item.key)}
                          {binding !== undefined && shortcutsLive && (
                            // Printed, not revealed on hover: a keyboard user
                            // never hovers, and a key nobody can see is a key
                            // nobody uses (docs/keyboard-map.md, principle 5).
                            <kbd className="text-muted-foreground tabular text-[10px]">
                              {formatBinding(binding)}
                            </kbd>
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
        </nav>

        {/*
          Focusable, and focused on every route change (see `useFocusOnRoute`).
          In a single-page application a navigation moves nothing: the old screen
          is replaced and the focus stays on whatever opened it, or lands on
          `<body>` when that element has gone with the screen. Either way the
          next `Tab` starts from the wrong place and a screen reader says
          nothing at all — so the new screen takes the focus, which is what a
          browser does for a real page load.
        */}
        <main id="main" ref={main} tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none">
          {children}
        </main>
      </div>
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
  // A trigger that opens nothing is the failure `select.tsx` describes: this
  // is a Radix popover, so it does nothing at all until React has attached.
  const hydrated = useHydrated()
  const [open, setOpen] = useState(false)

  // Signing in never asks for a name — it is an address and a code — so for
  // most people `name` is empty and the address is the only thing they would
  // recognise as themselves. An empty circle over a blank line is what this
  // block showed before.
  const shown = userName.trim() === '' ? userEmail : userName

  return (
    <section aria-label={t('shell.profile')} className="border-border border-t p-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={!hydrated}
          // The accessible name is the name on the row rather than an
          // `aria-label` saying "account menu": what you can see is what you
          // can say, and a label that replaces the visible text is a label a
          // voice user cannot guess.
          //
          // Focus and open both take the accent yellow fill — the black ring
          // on white was invisible against the page and against the design.
          className="group hover:bg-accent/60 focus-visible:bg-accent focus-visible:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground flex w-full items-center gap-2 px-2 py-1.5 text-left outline-none"
        >
          <span
            aria-hidden="true"
            // Soft yellow at rest; the open/focus fill on the row is the loud
            // one, so the initial steps back to the page colour then.
            className="bg-accent/50 text-foreground group-focus-visible:bg-background group-data-[state=open]:bg-background group-focus-visible:text-foreground group-data-[state=open]:text-foreground flex size-7 shrink-0 items-center justify-center text-xs font-semibold"
          >
            {initialOf(shown)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={shown}>
            {shown}
          </span>
          {/* Points along the row when shut and up the way the panel comes
              when open, so the affordance is not lying about the direction. */}
          <RiArrowRightSLine
            aria-hidden="true"
            className="text-muted-foreground group-focus-visible:text-accent-foreground group-data-[state=open]:text-accent-foreground size-4 shrink-0 transition-transform group-data-[state=open]:-rotate-90"
          />
        </PopoverTrigger>

        <PopoverContent side="top" align="start" sideOffset={8} className="w-56 p-0">
          {/* The name again, and the role with it. "As what am I in these
              books" is worth an answer, just not one printed at all times. */}
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

          <div className="space-y-3 px-3 py-3">
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
