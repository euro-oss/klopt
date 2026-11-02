import * as React from 'react'
import { cn } from 'cn'
import { Switch as SwitchPrimitive } from 'radix-ui'

/**
 * shadcn/ui Switch on Radix — maps export `.k-switch` (#107 Phase 0).
 *
 * Pill track, 44×26 touch target. Checked = primary ink; never browser blue.
 */

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-[26px] w-11 shrink-0 cursor-pointer items-center rounded-full border-0 bg-[var(--line-control)] p-0 transition-colors',
        'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform',
          'data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-[3px]',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
