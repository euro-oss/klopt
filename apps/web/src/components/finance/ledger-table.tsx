import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

/**
 * The table this application is made of (spec 11).
 *
 * Deliberately a plain semantic `<table>` rather than a div grid: screen
 * readers, `Cmd`+`C` into a spreadsheet, and browser find all work for free,
 * and the WCAG 2.2 AA target in section 12 stops being a project.
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

export function LedgerTable<TRow>({
  columns,
  rows,
  rowKey,
  onRowActivate,
  footer,
  empty = 'Niets te tonen.',
  caption,
}: {
  columns: readonly Column<TRow>[]
  rows: readonly TRow[]
  rowKey: (row: TRow) => string
  onRowActivate?: ((row: TRow) => void) | undefined
  footer?: ReactNode | undefined
  empty?: string | undefined
  caption?: string | undefined
}) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground border-border rounded-md border border-dashed p-6 text-sm">
        {empty}
      </p>
    )
  }

  return (
    <div className="border-border overflow-x-auto rounded-md border">
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
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              // Rows are focusable and activate on Enter: no list in this
              // application requires a mouse (docs/keyboard-map.md).
              tabIndex={onRowActivate === undefined ? undefined : 0}
              onClick={
                onRowActivate === undefined
                  ? undefined
                  : () => {
                      onRowActivate(row)
                    }
              }
              onKeyDown={
                onRowActivate === undefined
                  ? undefined
                  : (event) => {
                      if (event.key === 'Enter') onRowActivate(row)
                    }
              }
              className={cn(
                'border-border/60 border-b last:border-0',
                onRowActivate !== undefined &&
                  'hover:bg-accent focus:bg-accent cursor-pointer outline-none focus:outline-2',
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
          ))}
        </tbody>
        {footer !== undefined && (
          <tfoot className="border-border bg-muted/30 border-t font-medium">{footer}</tfoot>
        )}
      </table>
    </div>
  )
}
