import * as React from 'react'
import { RiCheckLine } from '@remixicon/react'
import { cn } from 'cn'

/**
 * Stepper — maps export `.k-steps` (#107 Phase 0).
 *
 * Horizontal pill steps: done / current / todo. Import wizard keeps its own
 * rail for now; this is the shared primitive for Setup and future reskins.
 */

export type StepperStep = {
  readonly id: string
  readonly label: React.ReactNode
}

export type StepperProps = {
  readonly steps: readonly StepperStep[]
  /** Zero-based index of the current step. */
  readonly current: number
  readonly 'aria-label'?: string
  readonly className?: string
  readonly onJump?: (index: number) => void
}

function Stepper({ steps, current, className, onJump, 'aria-label': ariaLabel }: StepperProps) {
  return (
    <ol
      data-slot="stepper"
      aria-label={ariaLabel}
      className={cn('m-0 flex list-none flex-wrap gap-1 p-0', className)}
    >
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'todo'
        const clickable = onJump !== undefined && index < current
        const inner = (
          <>
            <span
              className={cn(
                'text-ink-2 inline-flex size-5 items-center justify-center rounded-full bg-surface-sunken font-mono text-[11px] font-semibold',
                state === 'done' && 'bg-[var(--success-bg)] text-success',
                state === 'current' && 'bg-primary text-primary-foreground',
              )}
            >
              {state === 'done' ? <RiCheckLine className="size-3" aria-hidden /> : index + 1}
            </span>
            <span>{step.label}</span>
          </>
        )
        const cls = cn(
          'inline-flex h-8 items-center gap-2 rounded-full py-0 pr-3 pl-1.5 text-[13px] font-medium',
          state === 'todo' && 'text-ink-muted',
          state === 'done' && 'text-ink-2',
          state === 'current' && 'bg-surface text-ink font-semibold shadow-[var(--shadow-raised)]',
        )
        return (
          <li key={step.id} className={cls} aria-current={state === 'current' ? 'step' : undefined}>
            {clickable ? (
              <button
                type="button"
                className="inline-flex items-center gap-2"
                onClick={() => {
                  onJump(index)
                }}
              >
                {inner}
              </button>
            ) : (
              <span className="inline-flex items-center gap-2">{inner}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export { Stepper }
