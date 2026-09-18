import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { SelectField, SelectOption } from '~/components/ui/select-field'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'
import { setLocale } from '~/server/locale'
import type { ReactNode } from 'react'
import { useHydrated } from '~/lib/hydration'
import { cn } from '~/lib/utils'
import { formatDate } from '~/lib/format'
import type { FiscalYearOption, FiscalYearScope } from '~/lib/fiscal-year'
import { DEFAULT_THEME, type Theme } from '~/lib/theme'
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
        className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:px-3 focus:py-2"
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
          <div className="p-4 pb-3">
            <Link to="/" className="text-lg font-semibold tracking-tight">
              Klopt
            </Link>
            <p className="text-muted-foreground text-xs">{t('shell.tagline')}</p>
          </div>

          {entities.length > 0 && (
            <div className="px-4 pb-3">
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
            <div className="px-4 pb-3">
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
          <div className="px-4 pb-3">
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
                            <kbd className="text-muted-foreground tabular text-[10px] opacity-0 group-hover:opacity-100">
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

        <main id="main" className="min-w-0 flex-1 p-8">
          {children}
        </main>
      </div>
    </div>
  )
}

/**
 * Who you are, at the bottom of the sidebar.
 *
 * Its own block with a rule above it, because "which administration am I in
 * and as what" is the question somebody asks before they believe a number, and
 * it was previously three lines of small grey text under the sign-out link.
 *
 * The language picker lives here rather than in Instellingen: somebody who has
 * landed in the wrong language cannot read the word for "language" to go and
 * find it, so it sits where the eye already goes for account things — and it
 * is labelled in both languages for the same reason.
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

  // Signing in never asks for a name — it is an address and a code — so for
  // most people `name` is empty and the address is the only thing they would
  // recognise as themselves. An empty circle over a blank line is what this
  // block showed before.
  const shown = userName.trim() === '' ? userEmail : userName

  return (
    <section aria-label={t('shell.profile')} className="border-border border-t p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="bg-accent text-accent-foreground flex size-7 shrink-0 items-center justify-center text-xs font-semibold"
        >
          {initialOf(shown)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium" title={shown}>
            {shown}
          </span>
          {role !== '' && (
            <span className="text-muted-foreground block text-xs">{t('shell.role', { role })}</span>
          )}
        </span>
      </div>

      <div className="mt-3">
        <LanguagePicker />
      </div>

      <div className="mt-3">
        <ThemePicker />
      </div>

      <form method="post" action="/sign-out" className="mt-2">
        <button
          type="submit"
          className="text-muted-foreground hover:text-foreground text-xs underline"
        >
          {t('shell.signOut')}
        </button>
      </form>
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
    <header className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
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
  tone?: 'neutral' | 'good' | 'warn' | 'muted' | undefined
}) {
  return (
    <div className="border-border rounded-md border p-4">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular',
          tone === 'good' && 'text-foreground',
          tone === 'warn' && 'text-unreconciled',
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
 * In the sidebar rather than buried in Instellingen, and labelled in both
 * languages, because somebody who has landed in the wrong one cannot read the
 * word for "language" to go and find it.
 *
 * A `select` that submits on change: this is a two-option choice, and a save
 * button would be a second thing to find.
 */
function LanguagePicker() {
  const { locale, t } = useT()
  const router = useRouter()
  const hydrated = useHydrated()

  return (
    <SelectField
      label={t('language.label')}
      value={locale}
      disabled={!hydrated}
      size="sm"
      onValueChange={(chosen) => {
        void setLocale({ data: { locale: chosen } })
          // The whole tree re-renders from the root loader, which is where the
          // language is resolved — so no reload, and no flash of the language
          // somebody has just left.
          .then(() => router.invalidate())
          .catch((cause: unknown) => {
            console.error('[app] could not change language', cause)
          })
      }}
    >
      <SelectOption value="nl">{t('language.nl')}</SelectOption>
      <SelectOption value="en">{t('language.en')}</SelectOption>
    </SelectField>
  )
}

/**
 * Light or dark.
 *
 * Beside the language, because both are "how this looks to me" rather than
 * anything about the books. Light is the default and the theme is resolved on
 * the server, so switching is a cookie and a re-render rather than a flash of
 * the theme somebody has just left.
 */
function ThemePicker() {
  const { t } = useT()
  const router = useRouter()
  const hydrated = useHydrated()
  const theme = useRouterState({
    select: (state) => (state.matches[0]?.loaderData as { theme?: Theme } | undefined)?.theme,
  })

  return (
    <SelectField
      label={t('theme.label')}
      value={theme ?? DEFAULT_THEME}
      disabled={!hydrated}
      size="sm"
      onValueChange={(chosen) => {
        void setTheme({ data: { theme: chosen } })
          .then(() => router.invalidate())
          .catch((cause: unknown) => {
            console.error('[app] could not change theme', cause)
          })
      }}
    >
      <SelectOption value="light">{t('theme.light')}</SelectOption>
      <SelectOption value="dark">{t('theme.dark')}</SelectOption>
    </SelectField>
  )
}
