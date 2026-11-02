import { Link, useRouterState } from '@tanstack/react-router'
import { useT } from '~/i18n/provider'
import { cn } from '~/lib/utils'
import { isSettingsNavActive, SETTINGS_SUBNAV } from '~/lib/shell-nav'

/**
 * v2 SubNav — vertical list of Settings areas so the sidebar never grows.
 *
 * Phase 0 wires the four hub destinations onto existing routes. Full Settings
 * hub grouping lands in Phase 12.
 */
export function SettingsSubNav() {
  const { t } = useT()
  const path = useRouterState({ select: (s) => s.location.pathname })

  return (
    <nav
      aria-label={t('settings.subnav')}
      data-settings-subnav=""
      className="flex flex-col gap-0.5"
    >
      {SETTINGS_SUBNAV.map((item) => {
        const active = isSettingsNavActive(path, item)
        return (
          <Link
            key={item.id}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'text-ink-2 flex h-11 items-center justify-between gap-2 rounded-md px-2.5 text-left text-sm font-medium no-underline md:h-9',
              'hover:bg-surface-hover hover:text-ink',
              active && 'bg-surface text-ink shadow-[var(--shadow-raised)]',
              'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            )}
          >
            {t(item.key)}
          </Link>
        )
      })}
    </nav>
  )
}
