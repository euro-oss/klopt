import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BINDINGS, BINDINGS_BY_ID, bindingChips, type Binding } from '~/lib/keyboard'
import { Keycap } from '~/components/ui/keycap'
import { useOptionalAdvancedMode } from '~/lib/advanced-mode-context'
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
import { navLabelKey, paletteNavItems, type NavItem } from '~/lib/shell-nav'

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

const GROUPS: readonly MessageKey[] = [...new Set(BINDINGS.map((binding) => binding.group))]

/** Nav destinations that are not in the shared shell list (Nieuw …, aliases). */
const EXTRA_NAVIGABLE: readonly Binding[] = BINDINGS.filter(
  (binding) =>
    binding.to !== undefined &&
    ![
      'go.dashboard',
      'go.journal',
      'go.accounts',
      'go.balance',
      'go.profit',
      'go.trial',
      'go.invoices',
      'go.purchases',
      'go.inbox',
      'go.contacts',
      'go.bank',
      'go.match',
      'go.payments',
      'go.dunning',
      'go.vat',
      'go.members',
      'go.webhooks',
      'go.settings',
      'go.audit',
      'go.retention',
      'go.snapshots',
      'go.exact',
      'go.exactAlias',
      'go.moneybird',
      'go.fiscalYears',
      'go.auditFile',
      'go.debtorAgeing',
      'go.creditorAgeing',
    ].includes(binding.id),
)

type NavRow = {
  readonly item: NavItem
  readonly groupKey: MessageKey | undefined
  readonly binding: Binding
}

type HelpRow = {
  readonly id: string
  readonly labelKey: MessageKey
  readonly binding: Binding
}

/**
 * Help "Ga naar" shares `paletteNavItems` so order and simple labels match ⌘K
 * (Journaalposten / Proefbalans last when Geavanceerd is off).
 */
function helpGoToRows(role: string, advanced: boolean): readonly HelpRow[] {
  const rows: HelpRow[] = []
  for (const { item } of paletteNavItems(role, advanced)) {
    if (item.binding === undefined) continue
    const binding = BINDINGS_BY_ID.get(item.binding)
    if (binding === undefined) continue
    rows.push({
      id: binding.id,
      labelKey: navLabelKey(item, advanced),
      binding,
    })
  }
  return rows
}

/**
 * Match on what is on screen, not on what is in the registry.
 *
 * Nav rows use the shell's simple/advanced labels and group headings so ⌘K
 * agrees with the rail (#64 design review).
 */
function searchNav(
  translate: (key: MessageKey) => string,
  role: string,
  advanced: boolean,
  query: string,
): readonly NavRow[] {
  const needle = query.trim().toLowerCase()
  const rows: NavRow[] = []
  for (const { item, groupKey } of paletteNavItems(role, advanced)) {
    if (item.binding === undefined) continue
    const binding = BINDINGS_BY_ID.get(item.binding)
    if (binding === undefined) continue
    const label = translate(navLabelKey(item, advanced))
    const group = groupKey === undefined ? '' : translate(groupKey)
    if (
      needle !== '' &&
      !label.toLowerCase().includes(needle) &&
      !group.toLowerCase().includes(needle) &&
      !(binding.keys ?? '').replace(' ', '').includes(needle)
    ) {
      continue
    }
    rows.push({ item, groupKey, binding })
  }
  return rows
}

/**
 * Palette extras (Nieuw …). `new.entry` is Geavanceerd chrome — hide it when
 * the mode is off, matching the shell CTA and the `?` help sheet.
 */
function searchExtras(
  translate: (key: MessageKey) => string,
  query: string,
  advanced: boolean,
): readonly Binding[] {
  const source = advanced
    ? EXTRA_NAVIGABLE
    : EXTRA_NAVIGABLE.filter((binding) => binding.id !== 'new.entry')
  const needle = query.trim().toLowerCase()
  if (needle === '') return source
  return source.filter(
    (binding) =>
      translate(binding.label).toLowerCase().includes(needle) ||
      translate(binding.group).toLowerCase().includes(needle) ||
      (binding.keys ?? '').replace(' ', '').includes(needle),
  )
}

/** Help rows for a group; Geavanceerd gates `new.entry` like ⌘K. */
function helpRowsForGroup(group: MessageKey, role: string, advanced: boolean): readonly HelpRow[] {
  if (group === 'keys.group.goTo') return helpGoToRows(role, advanced)
  return BINDINGS.filter((binding) => {
    if (binding.group !== group) return false
    if (!advanced && binding.id === 'new.entry') return false
    return true
  }).map((binding) => ({
    id: binding.id,
    labelKey: binding.label,
    binding,
  }))
}

/** One row the cursor can be on: an action, a nav destination, an extra, or a hit. */
type Row =
  | { readonly kind: 'action'; readonly id: 'toggle-advanced' }
  | { readonly kind: 'nav'; readonly nav: NavRow }
  | { readonly kind: 'binding'; readonly binding: Binding }
  | { readonly kind: 'hit'; readonly hit: SearchHit }

export function CommandPalette({ role = '' }: { role?: string }) {
  const navigate = useNavigate()
  const { t } = useT()
  const advancedMode = useOptionalAdvancedMode()
  const [open, setOpen] = useState<'palette' | 'help' | null>(null)
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement | null>(null)
  const sheet = useRef<HTMLDivElement | null>(null)

  const [query, setQuery] = useState('')
  const advanced = advancedMode?.advanced ?? false
  const navigation = useMemo(() => searchNav(t, role, advanced, query), [t, role, advanced, query])
  const extras = useMemo(() => searchExtras(t, query, advanced), [t, query, advanced])

  const showAdvancedAction = useMemo(() => {
    if (advancedMode === null) return false
    const needle = query.trim().toLowerCase()
    if (needle === '') return true
    const labels = [
      t('shell.advancedToggleOn'),
      t('shell.advancedToggleOff'),
      t('shell.advanced'),
      'geavanceerd',
      'advanced',
    ]
    return labels.some((label) => label.toLowerCase().includes(needle))
  }, [advancedMode, query, t])

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
  const rows: readonly Row[] = useMemo(() => {
    const actionRows: Row[] = showAdvancedAction ? [{ kind: 'action', id: 'toggle-advanced' }] : []
    return [
      ...actionRows,
      ...navigation.map((nav): Row => ({ kind: 'nav', nav })),
      ...extras.map((binding): Row => ({ kind: 'binding', binding })),
      ...flattenGroups(groups).map((hit): Row => ({ kind: 'hit', hit })),
    ]
  }, [showAdvancedAction, navigation, extras, groups])
  const actionCount = showAdvancedAction ? 1 : 0
  const navCount = navigation.length

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
      // `n j` is Geavanceerd chrome — same gate as ⌘K and the help sheet.
      if (binding.id === 'new.entry' && !advanced) return
      if (binding.to !== undefined) {
        setOpen(null)
        void navigate({ to: binding.to })
      }
    },
    [navigate, advanced],
  )

  const { prefix } = useShortcuts(onTrigger)

  useEffect(() => {
    if (open === 'palette') input.current?.focus()
    if (open === 'help') sheet.current?.focus()
  }, [open])

  // Phone top-bar search (and anything else) opens the palette without a chord.
  useEffect(() => {
    const onOpen = (): void => {
      setQuery('')
      setCursor(0)
      setOpen('palette')
    }
    window.addEventListener('klopt:open-palette', onOpen)
    return () => {
      window.removeEventListener('klopt:open-palette', onOpen)
    }
  }, [])

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

    if (row.kind === 'action') {
      if (row.id === 'toggle-advanced' && advancedMode !== null) {
        if (advancedMode.saving) return
        void advancedMode.toggleAdvanced()
        setOpen(null)
      }
      return
    }

    if (row.kind === 'nav') {
      if (row.nav.binding.to === undefined) return
      setOpen(null)
      void navigate({ to: row.nav.binding.to })
      return
    }

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
          className="bg-overlay fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]"
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
            // sensible. `focus:outline-hidden`: the help path focuses this
            // container, and a 2px ring around the whole dialog is noise (#64).
            tabIndex={-1}
            aria-label={open === 'palette' ? t('palette.commands') : t('shell.help')}
            className="bg-popover border-border max-h-[70vh] w-full max-w-xl overflow-hidden border focus:outline-hidden"
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
                  className="border-border focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring w-full border-b bg-transparent px-4 py-3 text-base md:text-sm"
                />
                <div
                  id="pal-list"
                  role="listbox"
                  aria-label={t('palette.commands')}
                  className="max-h-[50vh] overflow-y-auto py-1"
                >
                  {rows.length === 0 && !searching && refusal === null && (
                    <p className="text-muted-foreground px-4 py-3 text-sm">
                      {t('palette.nothingFound')}
                    </p>
                  )}

                  {showAdvancedAction && advancedMode !== null && (
                    <section>
                      <h3 className="text-muted-foreground px-4 pt-2 pb-1 text-xs font-medium uppercase tracking-wide">
                        {t('palette.actions')}
                      </h3>
                      <ul>
                        <li>
                          <button
                            type="button"
                            role="option"
                            aria-selected={cursor === 0}
                            aria-busy={advancedMode.saving || undefined}
                            onMouseEnter={() => {
                              setCursor(0)
                            }}
                            onClick={() => {
                              go({ kind: 'action', id: 'toggle-advanced' })
                            }}
                            className={cn(
                              'flex min-h-11 w-full items-center justify-between px-4 py-2 text-left text-sm md:min-h-0',
                              cursor === 0 && 'bg-accent text-accent-foreground',
                            )}
                          >
                            <span>
                              {advancedMode.advanced
                                ? t('shell.advancedToggleOff')
                                : t('shell.advancedToggleOn')}
                            </span>
                            <span
                              className={cn(
                                'text-xs',
                                cursor === 0 ? 'text-accent-foreground' : 'text-muted-foreground',
                              )}
                            >
                              {t('shell.advancedNoShortcut')}
                            </span>
                          </button>
                        </li>
                      </ul>
                    </section>
                  )}

                  {navigation.length > 0 && (
                    <section>
                      <h3 className="text-muted-foreground px-4 pt-2 pb-1 text-xs font-medium uppercase tracking-wide">
                        {t('palette.navigation')}
                      </h3>
                      <ul>
                        {navigation.map((nav, navIndex) => {
                          const index = actionCount + navIndex
                          const label = t(navLabelKey(nav.item, advanced))
                          const active = index === cursor
                          return (
                            <li key={nav.binding.id}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={active}
                                onMouseEnter={() => {
                                  setCursor(index)
                                }}
                                onClick={() => {
                                  go({ kind: 'nav', nav })
                                }}
                                className={cn(
                                  'flex min-h-11 w-full items-center justify-between px-4 py-2 text-left text-sm md:min-h-0',
                                  active && 'bg-accent text-accent-foreground',
                                )}
                              >
                                <span>
                                  {label}
                                  {nav.groupKey !== undefined && (
                                    <span
                                      className={cn(
                                        'text-xs',
                                        active ? 'text-accent-foreground' : 'text-muted-foreground',
                                      )}
                                    >
                                      {' '}
                                      · {t(nav.groupKey)}
                                    </span>
                                  )}
                                </span>
                                <span className="flex shrink-0 items-center gap-1">
                                  {bindingChips(nav.binding).map((chip, position) => (
                                    <Keycap
                                      key={`${nav.binding.id}-${String(position)}`}
                                      className={
                                        active
                                          ? '!border-accent-foreground !text-accent-foreground'
                                          : undefined
                                      }
                                    >
                                      {chip}
                                    </Keycap>
                                  ))}
                                </span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  )}

                  {extras.length > 0 && (
                    <section>
                      <h3 className="text-muted-foreground px-4 pt-2 pb-1 text-xs font-medium uppercase tracking-wide">
                        {t('keys.group.new')}
                      </h3>
                      <ul>
                        {extras.map((binding, extraIndex) => {
                          const index = actionCount + navCount + extraIndex
                          const active = index === cursor
                          return (
                            <li key={binding.id}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={active}
                                onMouseEnter={() => {
                                  setCursor(index)
                                }}
                                onClick={() => {
                                  go({ kind: 'binding', binding })
                                }}
                                className={cn(
                                  'flex min-h-11 w-full items-center justify-between px-4 py-2 text-left text-sm md:min-h-0',
                                  active && 'bg-accent text-accent-foreground',
                                )}
                              >
                                <span>
                                  {t(binding.label)}
                                  <span
                                    className={cn(
                                      'text-xs',
                                      active ? 'text-accent-foreground' : 'text-muted-foreground',
                                    )}
                                  >
                                    {' '}
                                    · {t(binding.group)}
                                  </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-1">
                                  {bindingChips(binding).map((chip, position) => (
                                    <Keycap
                                      key={`${binding.id}-${String(position)}`}
                                      className={
                                        active
                                          ? '!border-accent-foreground !text-accent-foreground'
                                          : undefined
                                      }
                                    >
                                      {chip}
                                    </Keycap>
                                  ))}
                                </span>
                              </button>
                            </li>
                          )
                        })}
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
                      <h3 className="border-border text-muted-foreground mt-1 border-t px-4 pt-2 pb-1 text-xs font-medium uppercase tracking-wide">
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
                              const index =
                                actionCount +
                                navCount +
                                extras.length +
                                flattenGroups(groups).indexOf(hit)
                              const active = index === cursor
                              return (
                                <li key={`${hit.type}-${hit.id}`}>
                                  <button
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    onMouseEnter={() => {
                                      setCursor(index)
                                    }}
                                    onClick={() => {
                                      go({ kind: 'hit', hit })
                                    }}
                                    className={cn(
                                      'flex min-h-11 w-full items-baseline justify-between gap-3 px-4 py-2 text-left text-sm md:min-h-0',
                                      active && 'bg-accent text-accent-foreground',
                                    )}
                                  >
                                    <span className="min-w-0">
                                      <span className="block truncate">{hit.title}</span>
                                      {hit.subtitle !== null && hit.subtitle !== '' && (
                                        <span
                                          className={cn(
                                            'block truncate text-xs',
                                            active
                                              ? 'text-accent-foreground'
                                              : 'text-muted-foreground',
                                          )}
                                        >
                                          {hit.subtitle}
                                        </span>
                                      )}
                                    </span>
                                    {hit.date !== null && (
                                      <span
                                        className={cn(
                                          'shrink-0 tabular text-xs',
                                          active
                                            ? 'text-accent-foreground'
                                            : 'text-muted-foreground',
                                        )}
                                      >
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
                {GROUPS.map((group) => {
                  const rows = helpRowsForGroup(group, role, advanced)
                  if (rows.length === 0) return null
                  return (
                    <section key={group} className="mb-4">
                      <h3 className="text-muted-foreground mb-1 text-xs font-medium">{t(group)}</h3>
                      <dl className="space-y-1">
                        {rows.map((row) => (
                          <div
                            key={row.id}
                            className="flex items-baseline justify-between gap-4 text-sm"
                          >
                            <dt>{t(row.labelKey)}</dt>
                            <dd className="flex shrink-0 items-center gap-1">
                              {bindingChips(row.binding).map((chip, position) => (
                                <Keycap key={`${row.id}-${String(position)}`}>{chip}</Keycap>
                              ))}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  )
                })}
                <p className="text-muted-foreground text-xs">{t('palette.escapeNote')}</p>
                <p className="text-muted-foreground mt-2 text-xs">{t('palette.advancedNote')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
