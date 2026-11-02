import * as React from 'react'
import { cn } from 'cn'
import { Popover as PopoverPrimitive } from 'radix-ui'

/**
 * shadcn/ui Popover, on Radix.
 *
 * **Generated.** `shadcn add popover` rewrites this file, so the notes below
 * are the things a reader needs that the generator will not put back.
 *
 * **It needs JavaScript**, the same as the select: the trigger is a `<button>`
 * that does nothing until React attaches. Every use passes
 * `disabled={!hydrated}` — see the docstring on `useHydrated`.
 *
 * **The drop shadow is off**, for the reason `select.tsx` gives: the design is
 * flat, so a floating panel is separated from the page by a border in the line
 * colour rather than by a shadow.
 */

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-[var(--radius-xl)] bg-popover p-4 text-popover-foreground shadow-[var(--shadow-overlay)] outline-hidden duration-[160ms] data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-98 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-98 motion-reduce:animate-none motion-reduce:transition-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
