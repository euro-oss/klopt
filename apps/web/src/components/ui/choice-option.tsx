import * as React from 'react'
import { cn } from 'cn'
import { RadioGroupItem } from '~/components/ui/radio-group'

/**
 * ChoiceOption — radio styled as a selectable option row (#107 Phase 0).
 *
 * Match uses {@link MatchChoiceOption} (button, numbered key, optional
 * Suggested tag) so choosing confirms in one press per Match.dc.html.
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

/**
 * Match board ChoiceOption — `.k-option` as a button with a mono keycap.
 * At most one sibling should pass `suggested`.
 */
function MatchChoiceOption({
  choiceKey,
  title,
  meta,
  suggested = false,
  suggestedLabel,
  disabled = false,
  className,
  ...props
}: React.ComponentProps<'button'> & {
  readonly choiceKey: string
  readonly title: React.ReactNode
  readonly meta?: React.ReactNode
  readonly suggested?: boolean
  /** Visible "Suggested" tag when `suggested` is true. */
  readonly suggestedLabel?: string
}) {
  return (
    <button
      type="button"
      data-slot="match-choice"
      data-suggested={suggested ? 'true' : undefined}
      disabled={disabled}
      className={cn(
        'bg-surface text-ink flex w-full items-center gap-3.5 rounded-[var(--radius-lg)] border px-4 py-3.5 text-left text-sm',
        'hover:border-ink focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        'min-h-11 md:min-h-14',
        suggested
          ? 'border-selection-edge bg-brand-tint border-2 px-[15px] py-[13px]'
          : 'border-border',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="bg-surface-sunken text-ink-2 inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] font-mono text-xs font-semibold"
      >
        {choiceKey}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-semibold">{title}</span>
        {meta !== undefined && meta !== null && meta !== '' && (
          <span className="text-ink-2 text-[13px] tabular-nums">{meta}</span>
        )}
      </span>
      {suggested && suggestedLabel !== undefined && (
        <span className="text-[var(--brand-ink)] shrink-0 text-xs font-semibold">
          {suggestedLabel}
        </span>
      )}
    </button>
  )
}

export { ChoiceOption, MatchChoiceOption }
