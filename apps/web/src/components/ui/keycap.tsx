import type { ReactNode } from 'react'
import { BINDINGS_BY_ID, bindingChips, type Binding } from '~/lib/keyboard'
import { useHydrated } from '~/lib/hydration'
import { useT } from '~/i18n/provider'
import { cn } from '~/lib/utils'

/**
 * The keyboard, drawn on the screen it works on.
 *
 * It used to be visible in two places: the `?` sheet, which you have to know
 * about, and a hint in the sidebar revealed on hover, which a keyboard user
 * never triggers. The Alpha 4 boards put it in two more, and both are here: a
 * strip along the bottom of the pane the keys work in, and a panel in the corner
 * listing the screen's whole keyboard.
 *
 * Yellow outline, square, no fill and no shadow: the accent marks "this is the
 * keyboard" the way it marks the cursor, and an outline says "key" without
 * competing with the row or the figure beside it.
 *
 * Every one of these takes binding **ids**. A screen cannot print a key it has
 * not registered, a key that changes in the registry changes wherever it is
 * printed, and `Cmd` versus `Ctrl` is resolved in the one place that resolves it.
 */
export function Keycap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'border-primary text-foreground inline-flex min-w-6 items-center justify-center border px-1.5 py-0.5 text-[0.625rem] font-medium tracking-wider tabular',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

/**
 * Which step of the flow a pane is.
 *
 * `1 · POSTVAK`, `2 · NAKIJKEN`. The boards number the panes because the spine
 * is a sequence — list, then the thing you do to a row of it — and a reader
 * should be able to see which half the keyboard is in without pressing anything.
 */
export function StepBadge({ step, children }: { step: number; children: ReactNode }) {
  return (
    <span className="bg-primary text-primary-foreground inline-flex items-center px-2 py-0.5 text-[0.625rem] font-semibold tracking-widest uppercase">
      {step} · {children}
    </span>
  )
}

function bindingsOf(ids: readonly string[]): readonly Binding[] {
  return ids.flatMap((id) => {
    const binding = BINDINGS_BY_ID.get(id)
    return binding === undefined ? [] : [binding]
  })
}

/**
 * The keys for one pane, along its bottom edge.
 *
 * Rendered only after hydration, for the same reason the sidebar hints are: a
 * key printed before its listener exists is a promise broken for the first
 * half-second, which is exactly when somebody is reading it.
 */
export function ShortcutFooter({
  ids,
  className,
}: {
  readonly ids: readonly string[]
  readonly className?: string
}) {
  const { t } = useT()
  const hydrated = useHydrated()
  if (!hydrated) return null

  return (
    <div
      className={cn(
        'border-border text-muted-foreground mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border px-2 py-1.5 text-[0.6875rem]',
        className,
      )}
    >
      {bindingsOf(ids).map((binding) => (
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

/**
 * The screen's whole keyboard, in the corner.
 *
 * The boards put it over the top right of the work, so it is there without being
 * in the way and without having to be summoned. Hidden on a narrow window, where
 * it would sit on top of the thing it describes — the `?` sheet is still the
 * complete answer, and this is the reminder.
 */
export function ShortcutPanel({ ids }: { readonly ids: readonly string[] }) {
  const { t } = useT()
  const hydrated = useHydrated()
  if (!hydrated) return null

  return (
    <aside
      aria-label={t('shortcuts.title')}
      className="bg-background border-border fixed top-24 right-6 z-30 hidden max-w-64 border px-3 py-2 xl:block"
    >
      <p className="text-muted-foreground mb-1.5 text-[0.625rem] font-semibold tracking-widest uppercase">
        {t('shortcuts.title')}
      </p>
      <dl className="space-y-1">
        {bindingsOf(ids).map((binding) => (
          <div key={binding.id} className="flex items-center gap-2 text-[0.6875rem]">
            <dt className="flex shrink-0 items-center gap-1">
              {bindingChips(binding).map((chip, index) => (
                <Keycap key={`${binding.id}-${String(index)}`}>{chip}</Keycap>
              ))}
            </dt>
            <dd className="text-muted-foreground truncate">{t(binding.label)}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}
