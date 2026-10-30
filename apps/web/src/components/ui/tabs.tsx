import * as React from 'react'
import { cn } from 'cn'
import { Tabs as TabsPrimitive } from 'radix-ui'

/**
 * shadcn/ui Tabs on Radix — maps export `.k-tabs` (underline) and `.k-seg`
 * (segmented) (#107 Phase 0).
 *
 * Route strips (Reports / Journal) stay as Link-based SubNavs; this primitive
 * is for in-page tablists that don't navigate.
 */

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col', className)} {...props} />
  )
}

function TabsList({
  className,
  variant = 'underline',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  variant?: 'underline' | 'segmented'
}) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        variant === 'underline' && 'border-border group/tabs flex flex-wrap gap-1 border-b',
        variant === 'segmented' &&
          'bg-surface-sunken group/tabs inline-flex flex-wrap gap-0.5 rounded-[var(--radius-md)] p-0.5',
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex min-h-11 items-center px-3 text-sm md:min-h-9',
        'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        'text-ink-muted hover:text-ink',
        // Underline
        'group-data-[variant=underline]/tabs:border-b-2 group-data-[variant=underline]/tabs:border-transparent',
        'group-data-[variant=underline]/tabs:data-[state=active]:border-ink',
        'group-data-[variant=underline]/tabs:data-[state=active]:text-ink',
        'group-data-[variant=underline]/tabs:data-[state=active]:font-semibold',
        // Segmented
        'group-data-[variant=segmented]/tabs:rounded-[var(--radius-sm)]',
        'group-data-[variant=segmented]/tabs:data-[state=active]:bg-surface',
        'group-data-[variant=segmented]/tabs:data-[state=active]:text-ink',
        'group-data-[variant=segmented]/tabs:data-[state=active]:shadow-[var(--shadow-raised)]',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        'mt-4 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
