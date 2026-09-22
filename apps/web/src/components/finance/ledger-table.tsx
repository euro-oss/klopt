import { useRef, useState, type ReactNode } from 'react'
import { useT } from '~/i18n/provider'
import { useHydrated } from '~/lib/hydration'
import { isApple } from '~/lib/keyboard'
import {
  nextTypeAhead,
  resolveTableKey,
  toTsv,
  typeAheadTarget,
  type TypeAhead,
} from '~/lib/table-keyboard'
import { cn } from '~/lib/utils'

/**
 * The table this application is made of (spec 11).
 *
 * Deliberately a plain semantic `<table>` rather than a div grid: screen
 * readers, `Cmd`+`C` into a spreadsheet, and browser find all work for free,
 * and the WCAG 2.2 AA target in section 12 stops being a project.
 *
 * ## The keyboard
 *
 * `docs/keyboard-map.md` promised a row cursor, type-ahead, a selection and a
 * copy since before these tables existed; the tables made rows focusable, did
 * `Enter`, and stopped. So this component is where the rest of that table
 * lands: `↑`/`↓` or `j`/`k` move a cursor, letters and digits jump to a row,
 * `Space` selects one, `Shift` and an arrow extends, `Cmd`/`Ctrl`+`A` takes
 * every loaded row and `Cmd`/`Ctrl`+`C` copies what is selected as TSV.
 *
 * The copy matters more than it sounds. "Get this into Excel" is a daily
 * bookkeeper move and the answer used to be a mouse drag across a scrolling
 * table. What is copied is what the table shows, read straight out of the
 * cells — so a figure formatted for a Dutch reader arrives in the spreadsheet
 * the way it was on screen, and a column nobody can see is not silently added.
 *
 * Which key means what is decided in `~/lib/table-keyboard`, so the rules are
 * tested by naming keys rather than by driving a browser.
 *
 * Virtualisation (TanStack Virtual) belongs here when a list first exceeds a
 * few thousand rows — behind this same interface, so no screen changes.
 */

export interface Column<TRow> {
  readonly key: string
  readonly header: string
  readonly align?: 'left' | 'right'
  /** Narrow columns that should not absorb slack. */
  readonly width?: string
  readonly cell: (row: TRow) => ReactNode
}

/** Rows `PageUp`/`PageDown` cover. A screenful of a dense ledger, roughly. */
const PAGE = 12

/** Wall-clock, out here where reading it is not a render. */
function now(): number {
  return Date.now()
}

/** `document.execCommand`, for a browser that will not grant the clipboard. */
function legacyCopy(text: string): boolean {
  const carrier = document.createElement('textarea')
  carrier.value = text
  carrier.setAttribute('aria-hidden', 'true')
  carrier.style.position = 'fixed'
  carrier.style.opacity = '0'
  document.body.append(carrier)
  carrier.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    carrier.remove()
  }
}

export function LedgerTable<TRow>({
  columns,
  rows,
  rowKey,
  onRowActivate,
  footer,
  empty,
  caption,
  typeAheadColumn,
}: {
  columns: readonly Column<TRow>[]
  rows: readonly TRow[]
  rowKey: (row: TRow) => string
  onRowActivate?: ((row: TRow) => void) | undefined
  footer?: ReactNode | undefined
  empty?: string | undefined
  caption?: string | undefined
  /**
   * The column type-ahead searches, by `key`. Defaults to the first one.
   *
   * The map says type-ahead follows the column the table is sorted by, which
   * for a chart of accounts is the number and for a journal the entry number.
   * A table sorted by something other than its first column says so here.
   */
  typeAheadColumn?: string | undefined
}) {
  const { t, plural } = useT()
  const hydrated = useHydrated()

  const keys = rows.map(rowKey)

  /**
   * The cursor is a row, not an offset.
   *
   * Remembering the index would move the cursor whenever the list grew at the
   * top — a statement imported, a queue refreshed — which is the thing the
   * keyboard map calls out: loading more rows must not jump to the top. The
   * index is kept as well, for the case the row itself has gone.
   */
  const [at, setAt] = useState<{ key: string | null; index: number }>({ key: null, index: 0 })
  const found = at.key === null ? -1 : keys.indexOf(at.key)
  const cursor = found !== -1 ? found : Math.min(at.index, Math.max(0, keys.length - 1))

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())
  /** Where a `Shift`-extended selection started. */
  const anchor = useRef<number>(0)
  const [status, setStatus] = useState<string | null>(null)

  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const typed = useRef<TypeAhead>({ buffer: '', at: 0 })

  const rowElements = (): readonly HTMLTableRowElement[] => [...(bodyRef.current?.rows ?? [])]

  const focusRow = (index: number): void => {
    const key = keys[index]
    if (key === undefined) return
    setAt({ key, index })
    rowElements()[index]?.focus()
  }

  /** What the table shows, as text, for the copy and for type-ahead. */
  const textOf = (index: number): readonly string[] =>
    [...(rowElements()[index]?.cells ?? [])].map((cell) => cell.textContent ?? '')

  const copy = async (indexes: readonly number[]): Promise<void> => {
    const tsv = toTsv([columns.map((column) => column.header), ...indexes.map(textOf)])
    const copied = plural('table.copied', indexes.length)

    try {
      await navigator.clipboard.writeText(tsv)
      setStatus(copied)
    } catch {
      // The async clipboard is a permission, and a browser is allowed to
      // refuse it. The old way needs no permission, because it copies a
      // selection made by the user's own keystroke — so it is the fallback
      // rather than a reason to tell somebody their keystroke did nothing.
      setStatus(legacyCopy(tsv) ? copied : t('table.copyRefused'))
    }
  }

  const typeAheadColumnIndex = Math.max(
    0,
    typeAheadColumn === undefined
      ? 0
      : columns.findIndex((column) => column.key === typeAheadColumn),
  )

  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground border-border border p-4 text-sm">
        {empty ?? t('table.empty')}
      </p>
    )
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTableSectionElement>): void {
    // Somebody already took it — a global shortcut, usually.
    if (event.defaultPrevented) return

    const resolution = resolveTableKey(
      {
        key: event.key,
        modKey: isApple() ? event.metaKey : event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      },
      { index: cursor, count: rows.length, page: PAGE },
    )

    switch (resolution.action) {
      case 'move': {
        event.preventDefault()
        if (resolution.extend) {
          const from = Math.min(anchor.current, resolution.index)
          const to = Math.max(anchor.current, resolution.index)
          setSelection(new Set(keys.slice(from, to + 1)))
        } else {
          anchor.current = resolution.index
        }
        focusRow(resolution.index)
        return
      }

      case 'open': {
        if (onRowActivate === undefined) return
        const row = rows[resolution.index]
        if (row === undefined) return
        event.preventDefault()
        onRowActivate(row)
        return
      }

      case 'toggle': {
        event.preventDefault()
        const key = keys[resolution.index]
        if (key === undefined) return
        anchor.current = resolution.index
        setSelection((current) => {
          const next = new Set(current)
          if (!next.delete(key)) next.add(key)
          return next
        })
        return
      }

      case 'selectAll':
        event.preventDefault()
        setSelection(new Set(keys))
        setStatus(plural('table.selected', keys.length))
        return

      case 'copy': {
        event.preventDefault()
        const chosen =
          selection.size === 0
            ? [cursor]
            : keys.flatMap((key, index) => (selection.has(key) ? [index] : []))
        void copy(chosen)
        return
      }

      case 'typeAhead': {
        event.preventDefault()
        typed.current = nextTypeAhead(typed.current, resolution.character, now())

        const texts = rows.map((_, index) => textOf(index)[typeAheadColumnIndex] ?? '')
        const target = typeAheadTarget(texts, typed.current.buffer, cursor)
        if (target !== null) {
          anchor.current = target
          focusRow(target)
        }
        return
      }

      case 'leave':
        event.preventDefault()
        setSelection(new Set())
        setStatus(null)
        typed.current = { buffer: '', at: 0 }
        // Out of the list rather than to somewhere else: Escape abandons the
        // thing you are in, and the global keys are on the other side of it.
        rowElements()[cursor]?.blur()
        return

      case 'ignore':
        return
    }
  }

  return (
    <div>
      {/* What the keyboard just did, said out loud: a selection or a copy that
          only shows as a tint is one a screen-reader user makes blind. Rendered
          always rather than conditionally, so the region exists before it has
          something to announce. */}
      <p
        role="status"
        aria-live="polite"
        className="text-muted-foreground mb-1 min-h-4 text-right text-xs"
      >
        {hydrated ? (status ?? '') : ''}
      </p>

      <div className="border-border overflow-x-auto border">
        <table className="w-full border-collapse text-sm">
          {caption !== undefined && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-border bg-muted/50 border-b">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width === undefined ? undefined : { width: column.width }}
                  className={cn(
                    'text-muted-foreground px-3 py-2 font-medium',
                    column.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={bodyRef} onKeyDown={onKeyDown}>
            {rows.map((row, index) => {
              const key = keys[index] ?? String(index)
              const selected = selection.has(key)
              return (
                <tr
                  key={key}
                  // One row in the tab order, and the arrows move it: a table of
                  // four hundred rows that has to be tabbed through is a table
                  // nobody reaches the end of.
                  tabIndex={index === cursor ? 0 : -1}
                  aria-current={index === cursor ? true : undefined}
                  data-selected={selected}
                  onFocus={() => {
                    setAt({ key, index })
                    anchor.current = index
                  }}
                  onClick={
                    onRowActivate === undefined
                      ? undefined
                      : () => {
                          onRowActivate(row)
                        }
                  }
                  className={cn(
                    'border-border/60 border-b last:border-0 outline-none',
                    onRowActivate !== undefined && 'hover:bg-muted/60 cursor-pointer',
                    // The cursor uses `--ring` (black in light, yellow in dark):
                    // yellow-on-white is too thin for a hairline, so selection
                    // is a yellow fill with black text when the row is chosen.
                    index === cursor && 'outline-ring outline-2 -outline-offset-2',
                    // A selected row is marked at its edge rather than filled,
                    // so a selection of forty rows is still a table of figures.
                    selected && 'border-l-ring bg-muted/60 border-l-2 font-medium',
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn('px-3 py-1.5', column.align === 'right' && 'text-right')}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          {footer !== undefined && (
            <tfoot className="border-border bg-muted/30 border-t font-medium">{footer}</tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
