import type { ReactNode } from 'react'
import { BINDINGS_BY_ID, bindingChips } from '~/lib/keyboard'
import { useHydrated } from '~/lib/hydration'
import { useT } from '~/i18n/provider'
import { cn } from '~/lib/utils'

/**
 * A key, drawn as one.
 *
 * The keyboard was only visible in two places: the `?` sheet, which you have to
 * know about, and a hover hint in the sidebar, which a keyboard user never
 * triggers. A key printed on the screen it works on is the difference between a
 * shortcut somebody has and a shortcut somebody uses — principle 5 of
 * docs/keyboard-map.md, made visible rather than filed.
 *
 * Yellow outline, square, no fill: the accent marks "this is the keyboard" the
 * way it marks focus elsewhere, and an outline says "key" without competing
 * with the row or the figure next to it.
 */
export function Keycap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'border-primary text-foreground inline-flex min-w-6 items-center justify-center border px-1.5 py-0.5 text-[0.625rem] font-medium tracking-widest uppercase tabular',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

/**
 * The keys a screen answers to, along the bottom of the thing they work on.
 *
 * Declared as binding **ids**, so the caps come from the registry: a screen
 * cannot print a key it has not registered, and a key that changes in the
 * registry changes here. `Cmd` versus `Ctrl` is resolved in the same place as
 * everywhere else.
 *
 * Rendered only after hydration, for the same reason the sidebar hints are: a
 * key printed before the listener exists is a promise the screen breaks for the
 * first half-second, which is exactly when somebody is looking at it.
 */
export function ShortcutStrip({
  ids,
  floating = false,
  className,
}: {
  readonly ids: readonly string[]
  /** Fixed in the corner, for a screen whose work fills the page. */
  readonly floating?: boolean
  readonly className?: string
}) {
  const { t } = useT()
  const hydrated = useHydrated()
  if (!hydrated) return null

  const shown = ids.flatMap((id) => {
    const binding = BINDINGS_BY_ID.get(id)
    return binding === undefined ? [] : [binding]
  })

  return (
    <div
      aria-label={t('shortcuts.title')}
      className={cn(
        'border-border text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 border text-xs',
        floating
          ? 'bg-background fixed bottom-4 left-1/2 z-40 max-w-[calc(100vw-2rem)] -translate-x-1/2 px-3 py-2'
          : 'mt-4 px-3 py-2',
        className,
      )}
    >
      <span className="text-foreground text-[0.625rem] font-semibold tracking-widest uppercase">
        {t('shortcuts.title')}
      </span>
      {shown.map((binding) => (
        <span key={binding.id} className="flex items-center gap-1.5">
          {bindingChips(binding).map((chip, index) => (
            <Keycap key={`${binding.id}-${String(index)}`}>{chip}</Keycap>
          ))}
          <span>{t(binding.label)}</span>
        </span>
      ))}
    </div>
  )
}
