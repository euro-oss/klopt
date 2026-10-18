import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import { Slot } from 'radix-ui'

/**
 * Status and chrome badges.
 *
 * Status variants follow the redesign prototype: text in the hue, fill at ~8%,
 * hairline in `currentColor`. Yellow is never a severity — use `default` /
 * `secondary` / `outline` for neutral chrome; success / info / attention /
 * destructive for meaning.
 */
const badgeVariants = cva(
  'group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-none text-[0.625rem] font-semibold tracking-widest whitespace-nowrap uppercase transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 motion-reduce:transition-none [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default: 'border-0 bg-transparent px-0 py-0 text-foreground [a]:hover:text-foreground/70',
        secondary:
          'border-0 bg-transparent px-0 py-0 text-muted-foreground [a]:hover:text-foreground',
        outline:
          'h-[1.375rem] border border-border bg-transparent px-1.5 py-0 text-foreground [a]:hover:text-foreground/70',
        ghost: 'border-0 bg-transparent px-0 py-0 text-muted-foreground hover:text-foreground',
        link: 'border-0 bg-transparent px-0 py-0 text-foreground underline-offset-4 hover:underline',
        destructive:
          'h-[1.375rem] border border-current bg-destructive/8 px-1.5 py-0 text-destructive focus-visible:ring-destructive/20 [a]:hover:text-destructive/70',
        success:
          'h-[1.375rem] border border-current bg-success/8 px-1.5 py-0 text-success focus-visible:ring-success/20 [a]:hover:text-success/70',
        info: 'h-[1.375rem] border border-current bg-info/8 px-1.5 py-0 text-info focus-visible:ring-info/20 [a]:hover:text-info/70',
        attention:
          'h-[1.375rem] border border-current bg-warning/8 px-1.5 py-0 text-warning focus-visible:ring-warning/20 [a]:hover:text-warning/70',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
