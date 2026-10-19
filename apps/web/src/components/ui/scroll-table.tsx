/**
 * Horizontal scroll wrapper for dense tables on phone (#69 design review).
 *
 * Sticky first column + tabular-nums on numeric cells. Page itself does not
 * scroll sideways — only the table box does.
 */

import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

export function ScrollTable({
  children,
  className,
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <div data-slot="scroll-table" className={cn('overflow-x-auto', className)}>
      <div className="min-w-full">{children}</div>
    </div>
  )
}

/** Classes for a sticky first column that stays readable while scrolling. */
export const stickyFirstCol =
  '[&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-10 [&_th:first-child]:bg-background [&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:z-10 [&_td:first-child]:bg-background'
