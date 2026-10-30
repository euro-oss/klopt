import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'
import { Slot } from 'radix-ui'

/**
 * Status and chrome badges.
 *
 * Status variants follow the redesign prototype: text in the hue, fill at ~8%,
 * hairline in `currentColor`, 12px / medium / normal case. Yellow is never a
 * severity — use `default` / `secondary` / `outline` for neutral chrome;
 * success / info / attention / destructive for meaning.
 */
const badgeVariants = cva(
  // Export StatusPill: 22px radius-pill filled, no border, sentence case.
  'group/badge inline-flex h-[1.375rem] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[var(--radius-pill)] px-1.5 whitespace-nowrap transition-colors focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-destructive motion-reduce:transition-none [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default:
          'border-0 bg-surface-sunken px-1.5 text-xs font-medium tracking-normal text-foreground normal-case [a]:hover:text-foreground/70',
        secondary:
          'border-0 bg-surface-sunken px-1.5 text-xs font-medium tracking-normal text-muted-foreground normal-case [a]:hover:text-foreground',
        outline:
          'border border-border bg-transparent px-1.5 text-xs font-medium tracking-normal text-foreground normal-case [a]:hover:text-foreground/70',
        ghost:
          'border-0 bg-transparent px-0 text-xs font-medium tracking-normal text-muted-foreground normal-case hover:text-foreground',
        link: 'border-0 bg-transparent px-0 text-xs font-medium tracking-normal text-link normal-case underline-offset-4 hover:underline',
        destructive:
          'border-0 bg-destructive/10 px-1.5 text-xs font-medium tracking-normal text-destructive normal-case [a]:hover:text-destructive/70',
        success:
          'border-0 bg-success/10 px-1.5 text-xs font-medium tracking-normal text-success normal-case [a]:hover:text-success/70',
        info: 'border-0 bg-info/10 px-1.5 text-xs font-medium tracking-normal text-info normal-case [a]:hover:text-info/70',
        attention:
          'border-0 bg-unreconciled/10 px-1.5 text-xs font-medium tracking-normal text-unreconciled normal-case [a]:hover:text-unreconciled/70',
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
