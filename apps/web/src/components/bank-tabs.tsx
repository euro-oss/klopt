import { Link } from '@tanstack/react-router'
import { Badge } from '~/components/ui/badge'
import { useT } from '~/i18n/provider'
import { cn } from '~/lib/utils'

/**
 * Bank underline tabs — To match / Accounts / Payment batches (#107 Phase 7,
 * BankAccounts.dc.html / Match.dc.html). Shared with Bank Match; keep additive.
 */

export type BankTab = 'match' | 'accounts' | 'batches'

export function BankTabs({
  active,
  toMatchCount,
}: {
  readonly active: BankTab
  /** Brand badge on To match when > 0; never show 0. */
  readonly toMatchCount?: number | undefined
}) {
  const { t } = useT()
  const badge = toMatchCount !== undefined && toMatchCount > 0 ? toMatchCount : null

  return (
    <nav
      aria-label={t('bank.tabs')}
      data-bank-tabs=""
      className="border-border mt-1 flex w-full flex-wrap gap-1 border-b"
    >
      <TabLink to="/bank/match" current={active === 'match'}>
        {t('bank.tab.match')}
        {badge !== null && (
          <Badge className="bg-brand-tint ml-2 border-0 text-[var(--brand-ink)]">
            {String(badge)}
          </Badge>
        )}
      </TabLink>
      <TabLink to="/bank" current={active === 'accounts'}>
        {t('bank.tab.accounts')}
      </TabLink>
      <TabLink to="/payments" current={active === 'batches'}>
        {t('bank.tab.batches')}
      </TabLink>
    </nav>
  )
}

function TabLink({
  to,
  current,
  children,
}: {
  readonly to: '/bank/match' | '/bank' | '/payments'
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
