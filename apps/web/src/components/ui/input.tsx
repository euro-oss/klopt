import * as React from 'react'
import { cn } from 'cn'

/**
 * shadcn/ui Input, wired to redesign tokens (#61 slice 1).
 *
 * Full border on `--input` (`--line-strong`), not the radix-sera underline.
 * Matches `.field-control` / the prototype `.field`: 16px on phone (iOS zoom
 * trap), quieter `--line` dividers stay distinct from form fields. Square via
 * shared `--radius`. Focus uses outline-offset-0 like the prototype `.field`.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(function Input(
  { className, type, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        'field-control rounded-none transition-[color,border-color,background-color] duration-[120ms] outline-none',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:outline-2 aria-invalid:outline-offset-0 aria-invalid:outline-destructive',
        'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        'motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  )
})

export { Input }
