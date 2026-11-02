import * as React from 'react'
import { useState } from 'react'
import { cn } from 'cn'
import { Button } from '~/components/ui/button'
import { Keycap } from '~/components/ui/keycap'
import { useT } from '~/i18n/provider'

/**
 * DropZone — maps export `.k-drop` (#107 Phase 0).
 *
 * Thin wrapper for existing upload paths. Honest copy only — never promise
 * PDF or photo reading. Wired into Inbox / import screens in later phases.
 *
 * Border uses `--input` (→ `--ink-muted`) for a11y contrast, same as other
 * controls. Optional `inputRef` / `shortcut` / forwardRef are for host screens
 * that open the picker from a keyboard shortcut (BankAccounts `U`).
 */

export interface DropZoneProps extends Omit<React.ComponentProps<'div'>, 'onDrop'> {
  readonly title: string
  readonly description?: string
  readonly chooseLabel?: string
  /** Optional printed shortcut next to the choose button (e.g. `U`). */
  readonly shortcut?: string
  readonly accept?: string
  readonly multiple?: boolean
  readonly disabled?: boolean
  readonly onFiles?: (files: FileList) => void
  /** Imperative open for keyboard shortcuts on the host screen. */
  readonly inputRef?: React.RefObject<HTMLInputElement | null>
}

const DropZone = React.forwardRef<HTMLDivElement, DropZoneProps>(function DropZone(
  {
    className,
    title,
    description,
    chooseLabel,
    shortcut,
    accept,
    multiple = false,
    disabled = false,
    onFiles,
    inputRef: inputRefProp,
    ...props
  },
  ref,
) {
  const { t } = useT()
  const [over, setOver] = useState(false)
  const localRef = React.useRef<HTMLInputElement | null>(null)
  const inputRef = inputRefProp ?? localRef
  const label = chooseLabel ?? t('dropZone.chooseFile')

  function take(files: FileList | null): void {
    if (files === null || files.length === 0 || disabled) return
    onFiles?.(files)
  }

  return (
    <div
      ref={ref}
      data-slot="drop-zone"
      data-over={over ? '' : undefined}
      className={cn(
        // CoS / a11y: control borders use --input (→ --ink-muted), not faint line-control.
        'border-input bg-surface text-ink-2 flex flex-col items-center gap-2.5 rounded-[var(--radius-xl)] border-2 border-dashed px-8 py-8 text-center',
        over && 'border-selection-edge bg-brand-tint',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      onDragEnter={(event) => {
        event.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => {
        setOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        take(event.dataTransfer.files)
      }}
      {...props}
    >
      <strong className="text-ink text-sm font-semibold">{title}</strong>
      {description !== undefined && description !== '' ? (
        <span className="text-sm">{description}</span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          inputRef.current?.click()
        }}
      >
        {label}
        {shortcut !== undefined && shortcut !== '' ? (
          <Keycap className="ml-2">{shortcut}</Keycap>
        ) : null}
      </Button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          take(event.target.files)
          event.target.value = ''
        }}
      />
    </div>
  )
})

export { DropZone }
