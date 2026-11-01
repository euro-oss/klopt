import { Link } from '@tanstack/react-router'
import { Badge } from '~/components/ui/badge'
import { useT } from '~/i18n/provider'
import { formatDate } from '~/lib/format'
import {
  groupPeriodsByYear,
  vatPeriodShortLabel,
  vatPeriodStatus,
  type VatPeriodRow,
  type VatPeriodTone,
} from '~/lib/vat-screen'
import { cn } from '~/lib/utils'
import { localTodayIso } from '~/lib/local-clock'

const TONE_VARIANT: Record<
  VatPeriodTone,
  'success' | 'destructive' | 'info' | 'default' | 'secondary'
> = {
  success: 'success',
  danger: 'destructive',
  info: 'info',
  draft: 'default',
  muted: 'secondary',
}

function statusLabel(
  period: VatPeriodRow,
  today: string,
  t: (key: Parameters<ReturnType<typeof useT>['t']>[0], vars?: Record<string, string>) => string,
): { readonly text: string; readonly tone: VatPeriodTone } | null {
  const status = vatPeriodStatus(period, today)
  switch (status.kind) {
    case 'marked':
      return { text: t(status.labelKey), tone: status.tone }
    case 'late':
      return { text: t(status.labelKey), tone: status.tone }
    case 'ready':
      return { text: t(status.labelKey), tone: status.tone }
    case 'open':
      return { text: t(status.labelKey), tone: status.tone }
    case 'dueSoon':
      return { text: t(status.labelKey), tone: status.tone }
    case 'opens':
      return {
        text: t(status.labelKey, { date: formatDate(status.opensOn) }),
        tone: status.tone,
      }
  }
}

/**
 * Left rail of the Vat board: years, periods with StatusPills, ICP card.
 */
export function VatPeriodRail({
  periods,
  activeCode,
  icpEmpty,
  icpPeriod,
}: {
  readonly periods: readonly VatPeriodRow[]
  readonly activeCode: string | null
  readonly icpEmpty: boolean
  readonly icpPeriod: string | null
}) {
  const { t } = useT()
  const today = localTodayIso()
  const groups = groupPeriodsByYear(periods)

  return (
    <nav
      aria-label={t('vat.periodsNav')}
      className="flex w-full max-w-[260px] shrink-0 flex-col gap-1 md:sticky md:top-4"
    >
      <h1 className="text-foreground mb-3 text-2xl leading-[30px] font-semibold tracking-[-0.01em]">
        {t('vat.title')}
      </h1>

      {groups.map((group) => (
        <div key={group.year} className="flex flex-col gap-1">
          <span className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-semibold tracking-[0.04em] uppercase">
            {String(group.year)}
          </span>
          {group.periods.map((period) => {
            const active = period.code === activeCode
            const status = statusLabel(period, today, t)
            return (
              <Link
                key={period.code}
                to="/vat/$period"
                params={{ period: period.code }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'text-foreground hover:bg-surface-hover flex min-h-11 items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2.5 text-sm no-underline md:min-h-0 md:py-2.5',
                  active &&
                    'bg-[var(--selection)] font-semibold shadow-[inset_3px_0_0_var(--selection-edge)]',
                )}
              >
                <span className="flex-1">{vatPeriodShortLabel(period.kind, period.code)}</span>
                {status !== null && status.tone === 'muted' ? (
                  <span className="text-muted-foreground text-[13px]">{status.text}</span>
                ) : status !== null ? (
                  <Badge variant={TONE_VARIANT[status.tone]}>{status.text}</Badge>
                ) : null}
              </Link>
            )
          })}
        </div>
      ))}

      {icpPeriod !== null && (
        <div className="bg-card border-border mt-4 flex flex-col gap-1.5 rounded-[var(--radius-xl)] border p-4 text-[13px] shadow-[var(--shadow-raised)]">
          <strong className="text-foreground text-sm font-semibold">{t('vat.icpCardTitle')}</strong>
          <span className="text-muted-foreground">
            {icpEmpty ? t('vat.icpCardEmpty') : t('vat.icpCardFilled')}
          </span>
          <Link
            to="/vat/icp/$period"
            params={{ period: icpPeriod }}
            className="text-foreground text-sm font-semibold underline-offset-2 hover:underline"
          >
            {icpEmpty ? t('vat.icpCardOpenEmpty') : t('vat.icpCardOpen')}
          </Link>
        </div>
      )}
    </nav>
  )
}
