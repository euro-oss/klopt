import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useT } from '~/i18n/provider'
import { setLocale } from '~/server/locale'
import type { ReactNode } from 'react'
import { useHydrated } from '~/lib/hydration'
import { cn } from '~/lib/utils'
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

const NAVIGATION = [
  { to: '/', key: 'nav.dashboard', binding: 'go.dashboard' },
  { to: '/entries', key: 'nav.entries', binding: 'go.journal' },
  { to: '/accounts', key: 'nav.accounts', binding: 'go.accounts' },
  { to: '/invoices', key: 'nav.invoices', binding: 'go.invoices' },
  { to: '/inbox', key: 'nav.inbox', binding: 'go.inbox' },
  { to: '/purchases', key: 'nav.purchases', binding: 'go.purchases' },
  { to: '/contacts', key: 'nav.contacts', binding: 'go.contacts' },
  { to: '/bank', key: 'nav.bank', binding: 'go.bank' },
  { to: '/payments', key: 'nav.payments', binding: 'go.payments' },
  { to: '/dunning', key: 'nav.dunning', binding: 'go.dunning' },
  { to: '/vat', key: 'nav.vat', binding: 'go.vat' },
  { to: '/reports/trial-balance', key: 'nav.trialBalance', binding: 'go.trial' },
  { to: '/reports/balance-sheet', key: 'nav.balanceSheet', binding: 'go.balance' },
  { to: '/reports/profit-and-loss', key: 'nav.profitAndLoss', binding: 'go.profit' },
] as const

/**
 * Screens not everybody may open, so the nav does not offer one that answers
 * 403. The role list mirrors the permission the operation behind it requires —
 * settings needs `ledger:configure`, membership needs `members:manage`.
 */
const RESTRICTED_NAVIGATION = [
  {
    to: '/settings',
    key: 'nav.settings',
    binding: 'go.settings',
    roles: ['owner', 'accountant', 'bookkeeper'],
  },
  { to: '/members', key: 'nav.members', binding: 'go.members', roles: ['owner'] },
  // `ledger:export` is what the operation needs, and the roles that hold it are
  // the ones who would be asked for the log.
  {
    to: '/audit-log',
    key: 'nav.auditLog',
    binding: 'go.audit',
    roles: ['owner', 'accountant', 'auditor'],
  },
  // The preview needs `ledger:export`; changing anything needs
  // `retention:manage`, which only the owner holds. Both are on this screen and
  // the screen says which is which.
  {
    to: '/retention',
    key: 'nav.retention',
    binding: 'go.retention',
    roles: ['owner', 'accountant', 'auditor'],
  },
  // `ledger:read` sees them, `ledger:export` makes them. A seal nobody can see
  // is a seal nobody checks, so the bookkeeper gets the screen too.
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
] as const

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
  onSwitchEntity,
}: {
  children: ReactNode
  entities: readonly ShellEntity[]
  activeEntityId: string | null
  userName: string
  onSwitchEntity: (entityId: string) => void
}) {
  const path = useRouterState({ select: (state) => state.location.pathname })
  // The keys are listened for in an effect, so they do nothing until React has
  // taken over. Advertising them before then is the same broken promise as
  // advertising them with no listener at all, only shorter — so the hint
  // appears exactly when the key starts working.
  const shortcutsLive = useHydrated()
  const { t } = useT()
  const active = entities.find((entity) => entity.entityId === activeEntityId) ?? entities[0]
  const navigation = [
    ...NAVIGATION,
    ...RESTRICTED_NAVIGATION.filter((item) =>
      (item.roles as readonly string[]).includes(active?.role ?? ''),
    ),
  ]

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
        <nav
          aria-label={t('shell.navigation')}
          className="border-border w-60 shrink-0 border-r p-4"
        >
          <div className="mb-6">
            <Link to="/" className="text-lg font-semibold tracking-tight">
              Klopt
            </Link>
            <p className="text-muted-foreground text-xs">{t('shell.tagline')}</p>
          </div>

          {entities.length > 0 && (
            <div className="mb-6">
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs font-medium">
                  {t('shell.administration')}
                </span>
                <select
                  aria-label={t('shell.administration')}
                  value={active?.entityId ?? ''}
                  onChange={(event) => {
                    onSwitchEntity(event.target.value)
                  }}
                  className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
                >
                  {entities.map((entity) => (
                    <option key={entity.entityId} value={entity.entityId}>
                      {entity.entityName}
                    </option>
                  ))}
                </select>
              </label>
              {/* Outside the label on purpose: anything inside it becomes part
                  of the select's accessible name, so "Administratie" would read
                  as "Administratie … rol: owner" to a screen reader. */}
              {active !== undefined && (
                <p className="text-muted-foreground mt-1 text-xs">
                  {t('shell.role', { role: active.role })}
                </p>
              )}
            </div>
          )}

          <ul className="space-y-0.5">
            {navigation.map((item) => {
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
                      <kbd className="text-muted-foreground font-mono text-[10px] opacity-0 group-hover:opacity-100">
                        {formatBinding(binding)}
                      </kbd>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>

          <div className="mt-6 border-t pt-4">
            <Link
              to="/entries/new"
              className="bg-primary text-primary-foreground hover:bg-primary/90 block rounded-md px-3 py-2 text-center text-sm font-medium"
            >
              {t('shell.newEntry')}
            </Link>
          </div>

          <div className="text-muted-foreground mt-8 text-xs">
            <LanguagePicker />
            <p className="mt-3">{userName}</p>
            <form method="post" action="/sign-out">
              <button type="submit" className="hover:text-foreground mt-1 underline">
                {t('shell.signOut')}
              </button>
            </form>
          </div>
        </nav>

        <main id="main" className="min-w-0 flex-1 p-8">
          {children}
        </main>
      </div>
    </div>
  )
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
    <label className="block">
      <span className="mb-1 block font-medium">{t('language.label')}</span>
      <select
        value={locale}
        aria-label={t('language.label')}
        disabled={!hydrated}
        onChange={(event) => {
          const chosen = event.target.value
          void setLocale({ data: { locale: chosen } })
            // The whole tree re-renders from the root loader, which is where
            // the language is resolved — so no reload, and no flash of the
            // language somebody has just left.
            .then(() => router.invalidate())
            .catch((cause: unknown) => {
              console.error('[app] could not change language', cause)
            })
        }}
        className="border-input bg-background w-full rounded-md border px-2 py-1 text-xs"
      >
        <option value="nl">{t('language.nl')}</option>
        <option value="en">{t('language.en')}</option>
      </select>
    </label>
  )
}
