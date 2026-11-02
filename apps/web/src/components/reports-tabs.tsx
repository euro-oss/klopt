import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { isTypingInto } from '~/lib/keyboard'
import { cn } from '~/lib/utils'
import { visibleReportsTabs } from '~/lib/shell-nav'
import { useT } from '~/i18n/provider'

/**
 * Reports section tabs (#107 Phase 0, Designer v2).
 *
 * Order: P&L, Balans, Debiteuren, Crediteuren, Proefbalans. Digit keys 1–5
 * switch tabs on this strip only. No Geavanceerd gate. Journaalposten lives
 * under Journal, not here.
 */
export function ReportsTabs() {
  const { t } = useT()
  const path = useRouterState({ select: (state) => state.location.pathname })
  const navigate = useNavigate()
  const tabs = visibleReportsTabs()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || isTypingInto(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const digit = Number(event.key)
      if (!Number.isInteger(digit) || digit < 1) return
      const tab = tabs.find((item) => item.digit === digit)
      if (tab === undefined) return
      event.preventDefault()
      event.stopImmediatePropagation()
      void navigate({ to: tab.to })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [navigate, tabs])

  return (
    <nav
      aria-label={t('nav.reports')}
      data-reports-tabs=""
      className="border-border mb-4 flex flex-wrap gap-1 border-b"
    >
      {tabs.map((tab) => {
        const active = path === tab.to || path.startsWith(`${tab.to}/`)
        return (
          <Link
            key={tab.id}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center px-3 text-sm md:min-h-9',
              active
                ? 'text-ink border-ink border-b-2 font-semibold'
                : 'text-ink-muted hover:text-ink border-b-2 border-transparent',
            )}
          >
            <span>{t(tab.key)}</span>
            <span className="text-ink-muted ml-2 hidden font-mono text-[11px] md:inline">
              {tab.digit}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
