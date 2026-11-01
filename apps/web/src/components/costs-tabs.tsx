import { Link } from '@tanstack/react-router'
import { Badge } from '~/components/ui/badge'
import { useT } from '~/i18n/provider'
import { cn } from '~/lib/utils'

/**
 * Costs underline tabs — Bills / To approve / Payment batches / Suppliers
 * (#107 Phase 4 / #128).
 *
 * Payment batches keeps `/payments`. Suppliers links to Contacts (no suppliers
 * filter on that screen yet — plain `/contacts`, listed as a gap).
 */

export type CostsNavTab = 'bills' | 'approve' | 'batches' | 'suppliers'

export function CostsTabs({
  active,
  approveCount,
}: {
  readonly active: CostsNavTab
  /** Neutral badge on To approve when > 0; never show 0. */
  readonly approveCount?: number | undefined
}) {
  const { t } = useT()
  const badge = approveCount !== undefined && approveCount > 0 ? approveCount : null

  return (
    <nav
      aria-label={t('costs.tabs')}
      data-costs-tabs=""
      className="border-border mb-4 flex flex-wrap gap-1 border-b"
    >
      <Link
        to="/purchases"
        search={{ tab: 'bills' }}
        aria-current={active === 'bills' ? 'page' : undefined}
        className={tabClass(active === 'bills')}
      >
        {t('costs.tab.bills')}
      </Link>
      <Link
        to="/purchases"
        search={{ tab: 'approve' }}
        aria-current={active === 'approve' ? 'page' : undefined}
        className={tabClass(active === 'approve')}
      >
        {t('costs.tab.approve')}
        {badge !== null && (
          <Badge variant="secondary" className="ml-2">
            {String(badge)}
          </Badge>
        )}
      </Link>
      <Link
        to="/payments"
        aria-current={active === 'batches' ? 'page' : undefined}
        className={tabClass(active === 'batches')}
      >
        {t('costs.tab.batches')}
      </Link>
      <Link
        to="/contacts"
        aria-current={active === 'suppliers' ? 'page' : undefined}
        className={tabClass(active === 'suppliers')}
      >
        {t('costs.tab.suppliers')}
      </Link>
    </nav>
  )
}

function tabClass(current: boolean): string {
  return cn(
    'inline-flex min-h-11 items-center px-3 text-sm md:min-h-9',
    current
      ? 'text-ink border-ink border-b-2 font-semibold'
      : 'text-ink-muted hover:text-ink border-b-2 border-transparent',
  )
}
