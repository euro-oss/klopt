import * as React from 'react'
import { cn } from 'cn'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'

/**
 * shadcn/ui DropdownMenu on Radix — maps export `.k-menu` (#107 Phase 0).
 *
 * Overlay shadow (`--shadow-overlay`), radius-xl. Used for the administration
 * Switcher and other menus; EntitySwitcher still uses Popover + SelectField so
 * existing e2e `chooseOption` labels keep working.
 */

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-surface text-ink z-50 min-w-[260px] rounded-[var(--radius-xl)] p-1.5 shadow-[var(--shadow-overlay)]',
          'origin-(--radix-dropdown-menu-content-transform-origin) outline-hidden',
          'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-98',
          'data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-98',
          'motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn(
        'text-ink-muted px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[0.06em] uppercase',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset ? '' : undefined}
      className={cn(
        'text-ink flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-sm outline-none select-none',
        'hover:bg-surface-hover focus:bg-surface-hover data-[highlighted]:bg-surface-hover',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('bg-line-soft mx-1 my-1.5 h-px', className)}
      {...props}
    />
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuRadioItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        'text-ink flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-sm outline-none select-none',
        'hover:bg-surface-hover focus:bg-surface-hover data-[highlighted]:bg-surface-hover',
        'data-[state=checked]:bg-[var(--selection)]',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
}
