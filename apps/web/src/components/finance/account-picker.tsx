import { RiCheckLine } from '@remixicon/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useT } from '~/i18n/provider'
import {
  filterAccounts,
  isPostable,
  resolveAccount,
  type PickableAccount,
} from '~/lib/account-picker'
import { cn } from '~/lib/utils'

/**
 * Choosing a grootboekrekening, once, for every screen that asks for one.
 *
 * There were two answers to the same question before this. The journaalpost
 * screen had a native `<datalist>` over account *numbers*, which is perfect for
 * somebody who knows the chart by heart and useless to everybody else. Every
 * other screen had a `<select>` over the whole chart, which is a menu of two
 * hundred items and a scroll bar. Neither is what docs/keyboard-map.md
 * specifies, and the map is right: type a number or a word, arrows move, `Enter`
 * takes it, `Escape` leaves the field as it was.
 *
 * ## Why not Radix
 *
 * `Select` is a menu of known options, and this is a text field that filters
 * one — a combobox, which Radix does not ship. So the ARIA is written out here
 * (`combobox` over a `listbox`, `aria-activedescendant` for the highlight)
 * rather than approximated with a `Select` that cannot be typed into. It is the
 * one place in this application where that is the right call: everything else
 * keeps using the primitives, because everything else has a primitive.
 *
 * ## What it refuses
 *
 * A blocked account is listed, marked, and not selectable. The ledger will not
 * post to one, so offering it as a valid choice moves the refusal from the
 * field to the end of the form; hiding it altogether turns the refusal into "my
 * account is missing". Free text that resolves to nothing is put back to what
 * the field held before, because a number nobody recognises is a posting that
 * fails after the entry is written rather than while it is being typed.
 */
export function AccountPicker({
  label,
  labelHidden = false,
  hint,
  name,
  value,
  defaultValue = '',
  onValueChange,
  accounts,
  emptyOption,
  disabled = false,
  placeholder,
  autoFocus = false,
  className,
  inputClassName,
}: {
  /** Always present, even when hidden: the control needs an accessible name. */
  readonly label: string
  readonly labelHidden?: boolean
  readonly hint?: ReactNode
  /** Set this to have the account number submitted with the surrounding form. */
  readonly name?: string
  /** Controlled. Omit for an uncontrolled field and give `defaultValue`. */
  readonly value?: string
  readonly defaultValue?: string
  readonly onValueChange?: (value: string) => void
  readonly accounts: readonly PickableAccount[]
  /** The label for "no account at all", where that is a real choice. */
  readonly emptyOption?: string
  /** Pass `!hydrated`: filtering and the listbox are client-side. */
  readonly disabled?: boolean
  readonly placeholder?: string
  readonly autoFocus?: boolean
  readonly className?: string
  readonly inputClassName?: string
}) {
  const { t } = useT()
  const id = useId()
  const listId = `${id}-listbox`

  const [uncontrolled, setUncontrolled] = useState(defaultValue)
  const current = value ?? uncontrolled

  /**
   * What has been typed, or nothing — and `nothing` is the point.
   *
   * The field shows the chosen account's number until somebody types at it, and
   * derives that rather than copying it into state. A copy would have to be
   * kept in step with every way the value can change from outside: a line
   * duplicated by `Cmd`+`D`, a form emptied after posting, a draft arriving
   * from the server. Deriving it means there is nothing to keep in step.
   */
  const [query, setQuery] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const text = query ?? current
  /** True while the text is a query rather than the chosen account's number. */
  const typing = query !== null

  const list = useRef<HTMLUListElement>(null)

  const matches = typing ? filterAccounts(accounts, text) : accounts
  const chosen = accounts.find((account) => account.number === current) ?? null
  const showName = chosen !== null && !typing

  /** The rows arrows can land on: the empty choice, then the postable matches. */
  const reachable: (PickableAccount | null)[] = [
    ...(emptyOption === undefined ? [] : [null]),
    ...matches.filter(isPostable),
  ]
  const activeAccount = reachable[Math.min(active, reachable.length - 1)]
  const activeId = reachable.length === 0 ? undefined : `${id}-option-${String(active)}`

  useEffect(() => {
    if (!open) return
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function commit(account: PickableAccount | null): void {
    const next = account?.number ?? ''
    if (value === undefined) setUncontrolled(next)
    onValueChange?.(next)
    setQuery(null)
    setOpen(false)
    setActive(0)
  }

  /** Put the field back to the value it held, which is what Escape promises. */
  function abandon(): void {
    setQuery(null)
    setOpen(false)
    setActive(0)
  }

  function move(to: number): void {
    if (reachable.length === 0) return
    setActive(Math.min(Math.max(to, 0), reachable.length - 1))
    setOpen(true)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    // A modified key is somebody else's: `Cmd`+`Enter` posts the entry this
    // field is on, and `Cmd`+`K` opens the palette.
    if (event.metaKey || event.ctrlKey || event.altKey) return

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(open ? active + 1 : active)
        return
      case 'ArrowUp':
        event.preventDefault()
        move(open ? active - 1 : active)
        return
      case 'Home':
        if (!open) return
        event.preventDefault()
        move(0)
        return
      case 'End':
        if (!open) return
        event.preventDefault()
        move(reachable.length - 1)
        return
      case 'Enter':
        // Never let it submit the form from here: `Enter` commits the thing you
        // are in (principle 2), and the thing you are in is this field.
        event.preventDefault()
        if (open && activeAccount !== undefined) commit(activeAccount)
        else commit(resolveAccount(accounts, text))
        return
      case 'Escape':
        if (!open && text === current) return
        // Taken, so the shell does not also read it as "clear the focus".
        event.preventDefault()
        event.stopPropagation()
        abandon()
        return
      case 'Tab':
        // The map is explicit: Tab chooses the highlighted match and moves on.
        // Not prevented — moving on is the browser's job and it does it right.
        if (open && activeAccount !== undefined) commit(activeAccount)
        return
      default:
        return
    }
  }

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

      <div className="relative">
        <div
          className={cn(
            'border-input bg-background focus-within:border-ring flex items-center gap-2 border px-2 py-1.5',
            disabled && 'opacity-50',
            inputClassName,
          )}
        >
          <input
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            {...(activeId === undefined || !open ? {} : { 'aria-activedescendant': activeId })}
            autoComplete="off"
            // The browser's own suggestions over a listbox is two popups
            // fighting for the arrow keys.
            spellCheck={false}
            disabled={disabled}
            autoFocus={autoFocus}
            value={text}
            placeholder={placeholder}
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
              setActive(0)
            }}
            onFocus={(event) => {
              // Type-ahead on focus, not on click: reaching a field by Tab and
              // typing has to work without a pointer anywhere near it.
              setOpen(true)
              event.target.select()
            }}
            onBlur={() => {
              setOpen(false)
              if (!typing) return
              // Leaving a field half-typed keeps the account it had. Anything
              // else stores a number the ledger will refuse later.
              const resolved = resolveAccount(accounts, text)
              if (text.trim() === '' && emptyOption !== undefined) commit(null)
              else if (resolved !== null) commit(resolved)
              else abandon()
            }}
            onKeyDown={onKeyDown}
            className={cn(
              'tabular bg-transparent text-sm outline-none',
              // Room for a word while one is being typed, and only room for a
              // number once one is chosen: the name beside it takes the rest.
              showName ? 'w-20 shrink-0' : 'w-full',
            )}
          />
          {/* The name of what is chosen, next to the number it was chosen by.
              Both, always: the number is what gets typed and the name is what
              says it was the right one. */}
          {chosen !== null && !typing && (
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
              {chosen.name}
            </span>
          )}
        </div>

        {name !== undefined && <input type="hidden" name={name} value={current} />}

        {open && (
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label={label}
            className="bg-background border-border absolute z-50 mt-1 max-h-64 w-full min-w-64 overflow-y-auto border"
          >
            {emptyOption !== undefined && (
              <Option
                id={`${id}-option-0`}
                active={active === 0}
                selected={current === ''}
                onChoose={() => {
                  commit(null)
                }}
                onHover={() => {
                  setActive(0)
                }}
              >
                {emptyOption}
              </Option>
            )}

            {matches.map((account) => {
              const position = reachable.indexOf(account)
              return (
                <Option
                  key={account.number}
                  id={position === -1 ? undefined : `${id}-option-${String(position)}`}
                  active={position !== -1 && position === active}
                  selected={account.number === current}
                  blocked={!isPostable(account)}
                  onChoose={() => {
                    if (isPostable(account)) commit(account)
                  }}
                  onHover={() => {
                    if (position !== -1) setActive(position)
                  }}
                >
                  <span className="tabular">{account.number}</span> {account.name}
                  {isPostable(account) ? '' : ` · ${t('picker.blocked')}`}
                </Option>
              )
            })}

            {reachable.length === 0 && (
              <li className="text-muted-foreground px-2 py-1.5 text-sm">{t('picker.noMatches')}</li>
            )}
          </ul>
        )}
      </div>

      {hint !== undefined && (
        <span className="text-muted-foreground mt-1 block text-xs">{hint}</span>
      )}
    </div>
  )
}

function Option({
  id,
  active,
  selected,
  blocked = false,
  onChoose,
  onHover,
  children,
}: {
  readonly id?: string | undefined
  readonly active: boolean
  readonly selected: boolean
  readonly blocked?: boolean
  readonly onChoose: () => void
  readonly onHover: () => void
  readonly children: ReactNode
}) {
  return (
    <li
      {...(id === undefined ? {} : { id })}
      role="option"
      aria-selected={selected}
      {...(blocked ? { 'aria-disabled': true } : {})}
      data-active={active}
      // Mouse down would blur the input first, and the blur puts a half-typed
      // field back — so the click would land on a list that had already closed.
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      onClick={onChoose}
      onMouseEnter={onHover}
      className={cn(
        'flex items-center justify-between gap-2 px-2 py-1.5 text-sm',
        active && 'bg-accent text-accent-foreground font-medium',
        blocked && 'text-muted-foreground',
        !blocked && 'cursor-pointer',
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {selected && <RiCheckLine aria-hidden="true" className="size-4 shrink-0" />}
    </li>
  )
}
