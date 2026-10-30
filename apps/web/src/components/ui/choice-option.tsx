import * as React from 'react'
import { cn } from 'cn'
import { RadioGroupItem } from '~/components/ui/radio-group'

/**
 * ChoiceOption — radio styled as a selectable option row (#107 Phase 0).
 *
 * Full Match 1–4 restyle lands in the Bank Match phase; this is the primitive.
 */

function ChoiceOption({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadioGroupItem> & { children?: React.ReactNode }) {
  return (
    <label
      className={cn(
        'border-border bg-surface hover:bg-surface-hover flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border px-3 py-2.5',
        'has-[[data-state=checked]]:border-ink has-[[data-state=checked]]:shadow-[var(--shadow-raised)]',
        className,
      )}
    >
      <RadioGroupItem className="mt-0.5" {...props} />
      <span className="text-ink min-w-0 flex-1 text-sm">{children}</span>
    </label>
  )
}

export { ChoiceOption }
