import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BINDINGS, formatBinding, type Binding } from '~/lib/keyboard'
import { useShortcuts } from '~/lib/use-shortcuts'
import { cn } from '~/lib/utils'
import type { MessageKey } from '~/i18n/nl'
import { useT } from '~/i18n/provider'

/**
 * The command palette and the keyboard help, and the listener that opens them.
 *
 * "Every shortcut appears in the command palette with its key, and `?` shows
 * this map" — docs/keyboard-map.md, principle 5. So neither of these is a list
 * maintained alongside the registry; both are generated from it, and a binding
 * that is not in the registry does not exist.
 *
 * The palette offers **navigation only**, because navigation is the only thing
 * it can actually do from anywhere. `entry.post` belongs to the entry screen
 * and cannot be run from a palette floating over the balance sheet; offering it
 * would be offering something that does not work. The help sheet shows
 * everything, grouped, which is where the screen-local keys are documented.
 */

const NAVIGABLE: readonly Binding[] = BINDINGS.filter((binding) => binding.to !== undefined)

const GROUPS: readonly MessageKey[] = [...new Set(BINDINGS.map((binding) => binding.group))]

/**
 * Match on what is on screen, not on what is in the registry.
 *
 * The labels are message keys now, so searching the key would mean somebody
 * looking for "facturen" matching nothing while the word is right in front of
 * them. The translator is the search index.
 */
function search(translate: (key: MessageKey) => string, query: string): readonly Binding[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return NAVIGABLE
  return NAVIGABLE.filter(
    (binding) =>
      translate(binding.label).toLowerCase().includes(needle) ||
      translate(binding.group).toLowerCase().includes(needle) ||
      binding.keys.replace(' ', '').includes(needle),
  )
}

export function CommandPalette() {
  const navigate = useNavigate()
  const { t } = useT()
  const [open, setOpen] = useState<'palette' | 'help' | null>(null)
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement | null>(null)
  const sheet = useRef<HTMLDivElement | null>(null)

  const [query, setQuery] = useState('')
  const results = useMemo(() => search(t, query), [t, query])

  /**
   * Stable across renders, so the window listener is registered once.
   *
   * Re-registering a global keydown listener on every render is how a key ends
   * up handled twice.
   */
  const onTrigger = useCallback(
    (binding: Binding) => {
      if (binding.id === 'palette') {
        // Reset here rather than in an effect on `open`: opening is the event,
        // and deriving state from state through an effect is a render nobody
        // asked for.
        setQuery('')
        setCursor(0)
        setOpen((current) => (current === 'palette' ? null : 'palette'))
        return
      }
      if (binding.id === 'help') {
        setOpen((current) => (current === 'help' ? null : 'help'))
        return
      }
      if (binding.to !== undefined) {
        setOpen(null)
        void navigate({ to: binding.to })
      }
    },
    [navigate],
  )

  const { prefix } = useShortcuts(onTrigger)

  useEffect(() => {
    if (open === 'palette') input.current?.focus()
    if (open === 'help') sheet.current?.focus()
  }, [open])

  /**
   * Escape closes whichever overlay is up.
   *
   * On the overlay rather than on its input, because the help sheet has no
   * input — it is a list — and "Escape abandons the thing you are in" is
   * principle 2 of the keyboard map, not a property of text fields. The sheet
   * says "sluiten met Escape" on it; a sheet that says that and does not is
   * worse than one that says nothing.
   *
   * `useShortcuts` deliberately leaves a bare Escape alone for exactly this: it
   * belongs to whatever overlay or edit is open, and this is that overlay.
   */
  useEffect(() => {
    if (open === null) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      setOpen(null)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const go = (binding: Binding | undefined): void => {
    if (binding?.to === undefined) return
    setOpen(null)
    void navigate({ to: binding.to })
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((value) => Math.min(value + 1, results.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((value) => Math.max(value - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      go(results[cursor])
    }
  }

  return (
    <>
      {/*
        The armed prefix, shown while it is armed. A shortcut that silently
        waits is a shortcut people assume did not work — and a 1.5 second window
        with nothing on screen is exactly long enough to be confusing.
      */}
      {prefix !== null && (
        <div
          aria-live="polite"
          className="bg-foreground text-background fixed bottom-4 left-4 z-50 rounded-md px-3 py-1.5 text-sm tabular"
        >
          {prefix.toUpperCase()} …
        </div>
      )}

      {open !== null && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[10vh]"
          onClick={() => {
            setOpen(null)
          }}
        >
          <div
            ref={sheet}
            role="dialog"
            aria-modal="true"
            // Focusable so that opening the sheet moves focus into it, which is
            // what a screen reader needs and what makes Escape land somewhere
            // sensible.
            tabIndex={-1}
            aria-label={open === 'palette' ? t('palette.commands') : t('shell.help')}
            className="bg-background border-border max-h-[70vh] w-full max-w-xl overflow-hidden rounded-md border shadow-lg"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            {open === 'palette' ? (
              <>
                <input
                  ref={input}
                  type="text"
                  value={query}
                  aria-label={t('palette.search')}
                  placeholder={t('palette.searchPlaceholder')}
                  onChange={(event) => {
                    setQuery(event.currentTarget.value)
                    // Back to the top on every keystroke: the list underneath
                    // has changed, so a cursor on row four points at something
                    // else now.
                    setCursor(0)
                  }}
                  onKeyDown={onKeyDown}
                  className="border-border w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
                />
                <ul className="max-h-[50vh] overflow-y-auto py-1">
                  {results.length === 0 && (
                    <li className="text-muted-foreground px-4 py-3 text-sm">
                      {t('palette.nothingFound')}
                    </li>
                  )}
                  {results.map((binding, index) => (
                    <li key={binding.id}>
                      <button
                        type="button"
                        onMouseEnter={() => {
                          setCursor(index)
                        }}
                        onClick={() => {
                          go(binding)
                        }}
                        className={cn(
                          'flex w-full items-center justify-between px-4 py-2 text-left text-sm',
                          index === cursor && 'bg-muted',
                        )}
                      >
                        <span>
                          <span className="text-muted-foreground text-xs">
                            {t(binding.group)} ·{' '}
                          </span>
                          {t(binding.label)}
                        </span>
                        <kbd className="text-muted-foreground text-xs">
                          {formatBinding(binding)}
                        </kbd>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="max-h-[70vh] overflow-y-auto p-4">
                <h2 className="mb-3 text-sm font-semibold">{t('shell.help')}</h2>
                {GROUPS.map((group) => (
                  <section key={group} className="mb-4">
                    <h3 className="text-muted-foreground mb-1 text-xs font-medium">{t(group)}</h3>
                    <dl className="space-y-1">
                      {BINDINGS.filter((binding) => binding.group === group).map((binding) => (
                        <div key={binding.id} className="flex justify-between text-sm">
                          <dt>{t(binding.label)}</dt>
                          <dd className="text-muted-foreground tabular text-xs">
                            {formatBinding(binding)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
                <p className="text-muted-foreground text-xs">{t('palette.escapeNote')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
