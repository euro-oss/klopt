import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { useT } from '~/i18n/provider'
import {
  formatVatOpensDate,
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
  t: ReturnType<typeof useT>['t'],
  locale: 'nl' | 'en',
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
        text: t(status.labelKey, { date: formatVatOpensDate(status.opensOn, locale) }),
        tone: status.tone,
      }
  }
}

/**
 * Left rail of the Vat board: years, periods with StatusPills, ICP card.
 *
 * On phone the rail is full width and collapses to the selected period so the
 * return heading and totals stay above the fold (#162 design review). One DOM
 * list serves both widths — collapsed state hides non-active rows under md.
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
  const { t, locale } = useT()
  const today = localTodayIso()
  const groups = groupPeriodsByYear(periods)
  const [phoneOpen, setPhoneOpen] = useState(false)

  return (
    <nav
      aria-label={t('vat.periodsNav')}
      data-periods-collapsed={phoneOpen ? 'false' : 'true'}
      className="flex w-full shrink-0 flex-col gap-1 md:sticky md:top-4 md:max-w-[260px]"
    >
      <h1 className="text-foreground mb-3 text-2xl leading-[30px] font-semibold tracking-[-0.01em]">
        {t('vat.title')}
      </h1>

      <Button
        type="button"
        variant="outline"
        className="mb-1 min-h-11 justify-center md:hidden"
        aria-expanded={phoneOpen}
        onClick={() => {
          setPhoneOpen((open) => !open)
        }}
      >
        {phoneOpen ? t('vat.hidePeriods') : t('vat.changePeriod')}
      </Button>

      {groups.map((group) => {
        const hasActive = group.periods.some((period) => period.code === activeCode)
        return (
          <div
            key={group.year}
            className={cn('flex flex-col gap-1', !phoneOpen && !hasActive && 'max-md:hidden')}
          >
            <span
              className={cn(
                'text-muted-foreground px-3 pt-2 pb-1 text-xs font-semibold tracking-[0.04em] uppercase',
                !phoneOpen && 'max-md:hidden',
              )}
            >
              {String(group.year)}
            </span>
            {group.periods.map((period) => {
              const active = period.code === activeCode
              const status = statusLabel(period, today, t, locale)
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
                    !phoneOpen && !active && 'max-md:hidden',
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
        )
      })}

      {icpPeriod !== null && (
        <>
          {/* Phone: one-line link so the return stays above the fold. */}
          <Link
            to="/vat/icp/$period"
            params={{ period: icpPeriod }}
            className="text-foreground mt-2 text-sm font-semibold underline-offset-2 hover:underline md:hidden"
          >
            {icpEmpty ? t('vat.icpCardOpenEmpty') : t('vat.icpCardOpen')}
          </Link>
          <div className="bg-card border-border mt-4 hidden flex-col gap-1.5 rounded-[var(--radius-xl)] border p-4 text-[13px] shadow-[var(--shadow-raised)] md:flex">
            <strong className="text-foreground text-sm font-semibold">
              {t('vat.icpCardTitle')}
            </strong>
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
        </>
      )}
    </nav>
  )
}
