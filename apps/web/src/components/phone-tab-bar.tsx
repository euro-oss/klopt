import { Link } from '@tanstack/react-router'
import { FileText, House, Inbox, Landmark, Menu } from 'lucide-react'
import { useT } from '~/i18n/provider'
import { cn } from '~/lib/utils'
import { isNavActive, PHONE_TAB_BAR, type NavSearch, type PhoneTabId } from '~/lib/shell-nav'

/**
 * v2 PhoneTabBar (#107 Phase 0).
 *
 * Home · Sales · Inbox · Bank · More. More opens the existing #38 Sheet until
 * Batch 3 signs off phone boards. No copy that promises reading a photo.
 */

const ICONS = {
  home: House,
  sales: FileText,
  inbox: Inbox,
  bank: Landmark,
  more: Menu,
} as const

export function PhoneTabBar({
  path,
  search,
  moreOpen,
  onMore,
}: {
  path: string
  search?: NavSearch
  moreOpen: boolean
  onMore: () => void
}) {
  const { t } = useT()

  return (
    <nav
      aria-label={t('shell.phoneNav')}
      data-phone-tab-bar=""
      className="border-line bg-surface fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
    >
      {PHONE_TAB_BAR.map((tab) => {
        const Icon = ICONS[tab.id]
        if (tab.id === 'more') {
          return (
            <button
              key={tab.id}
              type="button"
              onClick={onMore}
              aria-expanded={moreOpen}
              aria-label={t(tab.key)}
              className={cn(
                'text-ink-muted relative flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                moreOpen && 'text-ink',
                'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              )}
            >
              <Icon className="size-[22px]" aria-hidden="true" />
              <span>{t(tab.key)}</span>
            </button>
          )
        }

        const active = isNavActive(path, tab.to, search, undefined, tab.alsoActiveFor)
        return (
          <Link
            key={tab.id}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            aria-label={t(tab.key)}
            className={cn(
              'text-ink-muted relative flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] font-medium no-underline',
              active && 'text-ink',
              'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            )}
          >
            <Icon className="size-[22px]" aria-hidden="true" />
            <span>{t(tab.key)}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export type { PhoneTabId }
