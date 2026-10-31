import { Link } from '@tanstack/react-router'
import { Badge } from '~/components/ui/badge'
import { useT } from '~/i18n/provider'
import { cn } from '~/lib/utils'

/**
 * Sales underline tabs — Invoices / Reminders / Customers (#107 Phase 2).
 *
 * `/dunning` stays the Reminders route. Customers links to Contacts (no
 * customers filter on that screen yet — plain `/contacts`, listed as a gap).
 */

export type SalesTab = 'invoices' | 'reminders' | 'customers'

export function SalesTabs({
  active,
  remindersCount,
}: {
  readonly active: SalesTab
  /** Danger badge on Reminders when > 0; never show 0. */
  readonly remindersCount?: number | undefined
}) {
  const { t } = useT()
  const reminderBadge = remindersCount !== undefined && remindersCount > 0 ? remindersCount : null

  return (
    <nav
      aria-label={t('sales.tabs')}
      data-sales-tabs=""
      className="border-border mb-4 flex flex-wrap gap-1 border-b"
    >
      <TabLink to="/invoices" current={active === 'invoices'}>
        {t('sales.tab.invoices')}
      </TabLink>
      <TabLink to="/dunning" current={active === 'reminders'}>
        {t('sales.tab.reminders')}
        {reminderBadge !== null && (
          <Badge variant="destructive" className="ml-2">
            {String(reminderBadge)}
          </Badge>
        )}
      </TabLink>
      <TabLink to="/contacts" current={active === 'customers'}>
        {t('sales.tab.customers')}
      </TabLink>
    </nav>
  )
}

function TabLink({
  to,
  current,
  children,
}: {
  readonly to: '/invoices' | '/dunning' | '/contacts'
  readonly current: boolean
  readonly children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-11 items-center px-3 text-sm md:min-h-9',
        current
          ? 'text-ink border-ink border-b-2 font-semibold'
          : 'text-ink-muted hover:text-ink border-b-2 border-transparent',
      )}
    >
      {children}
    </Link>
  )
}
