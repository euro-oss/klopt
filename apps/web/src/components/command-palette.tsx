import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BINDINGS, bindingChips, type Binding } from '~/lib/keyboard'
import { Keycap } from '~/components/ui/keycap'
import { useShortcuts } from '~/lib/use-shortcuts'
import { cn } from '~/lib/utils'
import {
  destinationOf,
  flattenGroups,
  groupHits,
  isSearchable,
  SEARCH_DEBOUNCE_MS,
  type SearchGroup,
  type SearchHit,
} from '~/lib/palette-search'
import { searchContent } from '~/server/search'
import { formatDate } from '~/lib/format'
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
 * ## Navigatie and Inhoud
 *
 * The palette used to offer navigation only, and said so: navigation is the one
 * thing it can do from anywhere, and `entry.post` cannot be run from a palette
 * floating over the balance sheet. That is still true of *commands*, and it was
 * never true of **content**. `GET /search` has existed since M6 and the MCP
 * `search` tool has been consuming it, so the agent could find a relatie by
 * name and the bookkeeper could not — which made "keyboard-first" half true at
 * best.
 *
 * So there are two halves now. Navigatie filters the registry in memory, on
 * every keystroke. Inhoud asks the server once the second character arrives —
 * two is what `searchQuery` requires, and waiting for it is better than showing
 * somebody a validation failure for typing. The hits come back grouped by kind
 * and `Enter` opens the record rather than a list it might be on.
 *
 * `/` stays unbound. The palette is where search lives (docs/keyboard-map.md),
 * and a second way in that focuses a field this dialogue owns would be a key
 * that means "open the thing ⌘K opens".
 *
 * The cursor walks both halves as one list, because that is what the arrows do:
 * a reader does not know or care which half the row they want came from.
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

/** One row the cursor can be on, from either half. */
type Row =
  | { readonly kind: 'binding'; readonly binding: Binding }
  | { readonly kind: 'hit'; readonly hit: SearchHit }

export function CommandPalette() {
  const navigate = useNavigate()
  const { t } = useT()
  const [open, setOpen] = useState<'palette' | 'help' | null>(null)
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement | null>(null)
  const sheet = useRef<HTMLDivElement | null>(null)

  const [query, setQuery] = useState('')
  const navigation = useMemo(() => search(t, query), [t, query])

  /**
   * The server's last answer, and **which question it answers**.
   *
   * One piece of state carrying the query, rather than three carrying the hits,
   * the truncation and the refusal: everything else is derived from whether the
   * answer is still about what is on screen. That is what keeps a reply from a
   * request nobody is waiting for any more off the list, and it means nothing
   * has to be cleared when the query changes — a stale answer simply stops
   * matching.
   *
   * `refusal` is why the content half is empty when it is empty for a reason.
   * `GET /search` is gated on `ledger:read` and nothing else — one gate, no role
   * filter (the Product call on #6) — and a role without it gets the API's own
   * sentence rather than a palette that silently finds nothing, which would read
   * as "there is no such relatie".
   */
  const [answer, setAnswer] = useState<{
    readonly query: string
    readonly hits: readonly SearchHit[]
    readonly truncated: readonly string[]
    readonly refusal: string | null
  } | null>(null)

  const needle = query.trim()
  const current = answer !== null && answer.query === needle ? answer : null
  const truncated = current?.truncated ?? []
  const refusal = current?.refusal ?? null
  const searching = open === 'palette' && isSearchable(needle) && current === null

  const groups: readonly SearchGroup[] = useMemo(() => groupHits(current?.hits ?? []), [current])
  const rows: readonly Row[] = useMemo(
    () => [
      ...navigation.map((binding): Row => ({ kind: 'binding', binding })),
      ...flattenGroups(groups).map((hit): Row => ({ kind: 'hit', hit })),
    ],
    [navigation, groups],
  )

  /**
   * Ask the server, once the typing settles.
   *
   * Debounced rather than per keystroke: `debiteuren` is one request this way
   * and nine the other, and the navigation half is already answering instantly
   * from memory while this waits.
   *
   * A rejection is recorded rather than swallowed. Storing nothing would leave
   * the palette saying "Zoeken…" about a request that is never coming back.
   */
  useEffect(() => {
    if (open !== 'palette' || !isSearchable(needle)) return

    const timer = setTimeout(() => {
      void searchContent({ data: { q: needle } }).then(
        (result) => {
          setAnswer({
            query: needle,
            hits: result.ok ? result.data.results : [],
            truncated: result.ok ? result.data.truncated : [],
            refusal: result.ok ? null : result.problem.detail,
          })
        },
        (error: unknown) => {
          setAnswer({
            query: needle,
            hits: [],
            truncated: [],
            refusal: error instanceof Error ? error.message : t('common.unknownError'),
          })
        },
      )
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [open, needle, t])

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

  /**
   * Open whatever the row is.
   *
   * A binding is a route. A hit is a record, and which screen shows it is
   * decided in `~/lib/palette-search` rather than here — a document has no
   * screen of its own and is opened as the file, which is what het postvak's
   * own link does.
   */
  const go = (row: Row | undefined): void => {
    if (row === undefined) return

    if (row.kind === 'binding') {
      if (row.binding.to === undefined) return
      setOpen(null)
      void navigate({ to: row.binding.to })
      return
    }

    const destination = destinationOf(row.hit)
    if (destination === null) return
    setOpen(null)
    if (destination.kind === 'download') {
      window.location.assign(destination.href)
      return
    }
    void navigate({ to: destination.to, params: destination.params })
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((value) => Math.min(value + 1, rows.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((value) => Math.max(value - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      go(rows[cursor])
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
          className="bg-foreground text-background fixed bottom-4 left-4 z-50 px-3 py-1.5 text-sm tabular"
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
            className="bg-background border-border max-h-[70vh] w-full max-w-xl overflow-hidden border"
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
                <div className="max-h-[50vh] overflow-y-auto py-1">
                  {rows.length === 0 && !searching && refusal === null && (
                    <p className="text-muted-foreground px-4 py-3 text-sm">
                      {t('palette.nothingFound')}
                    </p>
                  )}

                  {navigation.length > 0 && (
                    <section>
                      <h3 className="text-muted-foreground px-4 pt-2 pb-1 text-xs font-medium">
                        {t('palette.navigation')}
                      </h3>
                      <ul>
                        {navigation.map((binding, index) => (
                          <li key={binding.id}>
                            <button
                              type="button"
                              onMouseEnter={() => {
                                setCursor(index)
                              }}
                              onClick={() => {
                                go({ kind: 'binding', binding })
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
                              <span className="flex shrink-0 items-center gap-1">
                                {bindingChips(binding).map((chip, position) => (
                                  <Keycap key={`${binding.id}-${String(position)}`}>{chip}</Keycap>
                                ))}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {/* Said out loud rather than shown as a spinner: the list is
                      about to change under somebody who is reading it. */}
                  <p role="status" aria-live="polite" className="sr-only">
                    {searching ? t('palette.searching') : ''}
                  </p>

                  {refusal !== null && (
                    <p role="alert" className="text-destructive px-4 py-3 text-sm">
                      {refusal}
                    </p>
                  )}

                  {groups.length > 0 && (
                    <section>
                      <h3 className="border-border text-muted-foreground mt-1 border-t px-4 pt-2 pb-1 text-xs font-medium">
                        {t('palette.content')}
                      </h3>
                      {groups.map((group) => (
                        <div key={group.type}>
                          <h4 className="text-muted-foreground px-4 pt-1 text-xs">
                            {group.label === null ? group.type : t(group.label)}
                            {truncated.includes(group.type) && ` · ${t('palette.firstOnly')}`}
                          </h4>
                          <ul>
                            {group.hits.map((hit) => {
                              // The row's place in the one list the arrows walk.
                              const index = navigation.length + flattenGroups(groups).indexOf(hit)
                              return (
                                <li key={`${hit.type}-${hit.id}`}>
                                  <button
                                    type="button"
                                    onMouseEnter={() => {
                                      setCursor(index)
                                    }}
                                    onClick={() => {
                                      go({ kind: 'hit', hit })
                                    }}
                                    className={cn(
                                      'flex w-full items-baseline justify-between gap-3 px-4 py-2 text-left text-sm',
                                      index === cursor && 'bg-muted',
                                    )}
                                  >
                                    <span className="min-w-0">
                                      <span className="block truncate">{hit.title}</span>
                                      {hit.subtitle !== null && hit.subtitle !== '' && (
                                        <span className="text-muted-foreground block truncate text-xs">
                                          {hit.subtitle}
                                        </span>
                                      )}
                                    </span>
                                    {hit.date !== null && (
                                      <span className="text-muted-foreground shrink-0 tabular text-xs">
                                        {formatDate(hit.date)}
                                      </span>
                                    )}
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      ))}
                    </section>
                  )}
                </div>
              </>
            ) : (
              <div className="max-h-[70vh] overflow-y-auto p-4">
                <h2 className="mb-3 text-sm font-semibold">{t('shell.help')}</h2>
                {GROUPS.map((group) => (
                  <section key={group} className="mb-4">
                    <h3 className="text-muted-foreground mb-1 text-xs font-medium">{t(group)}</h3>
                    <dl className="space-y-1">
                      {BINDINGS.filter((binding) => binding.group === group).map((binding) => (
                        <div
                          key={binding.id}
                          className="flex items-baseline justify-between gap-4 text-sm"
                        >
                          <dt>{t(binding.label)}</dt>
                          <dd className="flex shrink-0 items-center gap-1">
                            {bindingChips(binding).map((chip, position) => (
                              <Keycap key={`${binding.id}-${String(position)}`}>{chip}</Keycap>
                            ))}
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
