import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { isTypingInto } from '~/lib/keyboard'
import { cn } from '~/lib/utils'
import { isNavActive, visibleJournalTabs } from '~/lib/shell-nav'
import { useT } from '~/i18n/provider'

/**
 * Journal section tabs (#107 Phase 0, Designer v2).
 *
 * Entries / Trial balance — underline strip (`.k-tabs`). Digit keys 1–2 on
 * this strip only. Ledger per account is [API] and omitted (no tab, no
 * placeholder) until PM scope sign-off.
 */
export function JournalTabs() {
  const { t } = useT()
  const path = useRouterState({ select: (state) => state.location.pathname })
  const navigate = useNavigate()
  const tabs = visibleJournalTabs()

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
      aria-label={t('nav.journal')}
      data-journal-tabs=""
      className="border-border mb-4 flex flex-wrap gap-1 border-b"
    >
      {tabs.map((tab) => {
        const active = isNavActive(path, tab.to, undefined, undefined, tab.alsoActiveFor)
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
