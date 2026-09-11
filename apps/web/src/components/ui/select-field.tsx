import { type ReactNode, useId, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { cn } from '~/lib/utils'

/**
 * A labelled select, composed from the shadcn primitives.
 *
 * There are thirty-odd of these across the application and they are nearly all
 * the same shape: a label, a value, a list. Composing the five primitives by
 * hand at every one of them is thirty chances to wire the label to nothing.
 *
 * Two things it owns that a bare `Select` does not:
 *
 * **The empty value.** Radix throws on `<SelectItem value="">` — it reserves
 * the empty string to mean "nothing selected". But half these fields have a
 * real, selectable `— kies —` entry whose value *is* the empty string, and the
 * handlers behind them already read `''` as "not chosen". So the empty string
 * is mapped to a sentinel on the way in and back again on the way out, and
 * call sites keep the value they always had.
 *
 * **What a form submits.** Radix's own hidden input would carry the sentinel.
 * This renders its own instead, holding the real value, so the screens that
 * read `FormData` — setup, relaties, instellingen, toegang — get `''` where
 * they used to get `''`.
 */

/** Radix reserves `''`, so the empty option travels under an assumed name. */
const EMPTY = '__klopt_empty__'

const toRadix = (value: string): string => (value === '' ? EMPTY : value)
const fromRadix = (value: string): string => (value === EMPTY ? '' : value)

export function SelectField({
  label,
  labelHidden = false,
  hint,
  name,
  value,
  defaultValue = '',
  onValueChange,
  disabled = false,
  placeholder,
  size,
  children,
  className,
  triggerClassName,
}: {
  /** Always present, even when hidden: the control needs an accessible name. */
  readonly label: string
  readonly labelHidden?: boolean
  readonly hint?: ReactNode
  /** Set this to have the value submitted with the surrounding form. */
  readonly name?: string
  /** Controlled. Omit for an uncontrolled field and give `defaultValue`. */
  readonly value?: string
  readonly defaultValue?: string
  readonly onValueChange?: (value: string) => void
  /** Pass `!hydrated`. See the note on `~/components/ui/select`. */
  readonly disabled?: boolean
  readonly placeholder?: string
  /**
   * The trigger's height, as the theme defines it.
   *
   * A prop rather than `triggerClassName="h-8"`, because the preset sets the
   * height through `data-[size=default]:h-10` — a data-attribute selector that
   * beats a plain `h-8` in the cascade, so the class looked applied and did
   * nothing.
   */
  readonly size?: 'sm' | 'default'
  readonly children: ReactNode
  readonly className?: string
  readonly triggerClassName?: string
}) {
  const id = useId()
  const [uncontrolled, setUncontrolled] = useState(defaultValue)
  const current = value ?? uncontrolled

  return (
    <div className={cn('block', className)}>
      <label
        htmlFor={id}
        className={cn(
          'text-muted-foreground mb-1 block text-xs font-medium',
          labelHidden && 'sr-only',
        )}
      >
        {label}
      </label>

      <Select
        value={toRadix(current)}
        onValueChange={(next) => {
          const real = fromRadix(next)
          if (value === undefined) setUncontrolled(real)
          onValueChange?.(real)
        }}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          {...(size === undefined ? {} : { size })}
          className={cn('w-full', triggerClassName)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>

      {/* Ours rather than Radix's, so the form sees the real value and not the
          sentinel standing in for the empty one. */}
      {name !== undefined && <input type="hidden" name={name} value={current} />}

      {hint !== undefined && (
        <span className="text-muted-foreground mt-1 block text-xs">{hint}</span>
      )}
    </div>
  )
}

/**
 * One option.
 *
 * Takes the value the call site means, including `''`, and hands Radix
 * something it will accept.
 */
export function SelectOption({
  value,
  children,
  disabled,
}: {
  readonly value: string
  readonly children: ReactNode
  readonly disabled?: boolean
}) {
  // Spread rather than `disabled={disabled}`: with exactOptionalPropertyTypes,
  // an explicit `undefined` is not the same as an absent prop.
  return (
    <SelectItem value={toRadix(value)} {...(disabled === undefined ? {} : { disabled })}>
      {children}
    </SelectItem>
  )
}
