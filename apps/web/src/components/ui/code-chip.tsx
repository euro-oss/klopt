import * as React from 'react'
import { cn } from 'cn'

/**
 * CodeChip — maps export `.k-code` (#107 Phase 0).
 *
 * Mono chip for VAT / RGS / ledger numbers / hashes. Not a severity badge.
 */

function CodeChip({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="code-chip"
      className={cn(
        'bg-surface-sunken text-ink-2 inline-block rounded-[var(--radius-xs)] px-1.5 font-mono text-[11px] leading-[18px] font-medium whitespace-nowrap',
        className,
      )}
      {...props}
    />
  )
}

export { CodeChip }
