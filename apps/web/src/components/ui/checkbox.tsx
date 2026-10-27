import * as React from 'react'
import { RiCheckLine } from '@remixicon/react'
import { cn } from 'cn'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'

/**
 * shadcn/ui Checkbox on Radix. Ink when checked — never browser blue.
 */

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'border-input peer size-4 shrink-0 rounded-none border outline-none transition-[background-color,border-color,color]',
        'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <RiCheckLine className="size-3.5" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
