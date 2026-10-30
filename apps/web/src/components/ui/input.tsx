import * as React from 'react'
import { cn } from 'cn'

/**
 * shadcn/ui Input, wired to redesign tokens (#107).
 *
 * Full border on `--input`; radius via `.field-control` / `--radius`. 16px on
 * phone (iOS zoom trap). Focus uses outline-offset-0 like export `.field`.
 *
 * Do not reset the outline style to none here: in Tailwind 4, `outline-2`
 * reuses `--tw-outline-style`, so a none-style reset would leave focus with
 * width 2px and style none (invisible).
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
        'field-control transition-[color,border-color,background-color] duration-[120ms]',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-0 aria-invalid:outline-destructive',
        'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        'motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  )
})

export { Input }
