import { Link, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'
import { BINDINGS_BY_ID, formatBinding } from '~/lib/keyboard'

/**
 * The frame every screen sits in.
 *
 * Navigation shows its shortcut next to each item, because a shortcut nobody
 * can see is a shortcut nobody uses (docs/keyboard-map.md).
 */

const NAVIGATION = [
  { to: '/', label: 'Dashboard', binding: 'go.dashboard' },
  { to: '/entries', label: 'Journaalposten', binding: 'go.journal' },
  { to: '/accounts', label: 'Grootboek', binding: 'go.accounts' },
  { to: '/invoices', label: 'Verkoopfacturen', binding: 'go.invoices' },
  { to: '/contacts', label: 'Relaties', binding: 'go.contacts' },
  { to: '/bank', label: 'Bank', binding: 'go.bank' },
  { to: '/dunning', label: 'Aanmaningen', binding: 'go.dunning' },
  { to: '/reports/trial-balance', label: 'Proefbalans', binding: 'go.trial' },
  { to: '/reports/balance-sheet', label: 'Balans', binding: 'go.balance' },
  { to: '/reports/profit-and-loss', label: 'Winst & verlies', binding: 'go.profit' },
] as const

/**
 * Screens not everybody may open, so the nav does not offer one that answers
 * 403. The role list mirrors the permission the operation behind it requires —
 * settings needs `ledger:configure`, membership needs `members:manage`.
 */
const RESTRICTED_NAVIGATION = [
  {
    to: '/settings',
    label: 'Instellingen',
    binding: 'go.settings',
    roles: ['owner', 'accountant', 'bookkeeper'],
  },
  { to: '/members', label: 'Toegang', binding: 'go.members', roles: ['owner'] },
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
  const active = entities.find((entity) => entity.entityId === activeEntityId) ?? entities[0]
  const navigation = [
    ...NAVIGATION,
    ...RESTRICTED_NAVIGATION.filter((item) =>
      (item.roles as readonly string[]).includes(active?.role ?? ''),
    ),
  ]

  return (
    <div className="bg-background text-foreground min-h-screen">
      <a
        href="#main"
        className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:px-3 focus:py-2"
      >
        Naar de inhoud
      </a>

      <div className="flex min-h-screen">
        <nav aria-label="Hoofdnavigatie" className="border-border w-60 shrink-0 border-r p-4">
          <div className="mb-6">
            <Link to="/" className="text-lg font-semibold tracking-tight">
              Klopt
            </Link>
            <p className="text-muted-foreground text-xs">Open boekhouden</p>
          </div>

          {entities.length > 0 && (
            <div className="mb-6">
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs font-medium">
                  Administratie
                </span>
                <select
                  aria-label="Administratie"
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
                <p className="text-muted-foreground mt-1 text-xs">rol: {active.role}</p>
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
                    {item.label}
                    {binding !== undefined && (
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
              Nieuwe journaalpost
            </Link>
          </div>

          <div className="text-muted-foreground mt-8 text-xs">
            <p>{userName}</p>
            <form method="post" action="/sign-out">
              <button type="submit" className="hover:text-foreground mt-1 underline">
                Afmelden
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
  tone?: 'neutral' | 'good' | 'warn' | undefined
}) {
  return (
    <div className="border-border rounded-md border p-4">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular',
          tone === 'good' && 'text-foreground',
          tone === 'warn' && 'text-unreconciled',
        )}
      >
        {value}
      </p>
      {hint !== undefined && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </div>
  )
}
