import * as React from 'react'
import { useState } from 'react'
import { cn } from 'cn'
import { Button } from '~/components/ui/button'

/**
 * DropZone — maps export `.k-drop` (#107 Phase 0).
 *
 * Thin wrapper for existing upload paths. Honest copy only — never promise
 * PDF or photo reading. Wired into Inbox / import screens in later phases.
 */

export interface DropZoneProps extends Omit<React.ComponentProps<'div'>, 'onDrop'> {
  readonly title: string
  readonly description?: string
  readonly chooseLabel?: string
  readonly accept?: string
  readonly multiple?: boolean
  readonly disabled?: boolean
  readonly onFiles?: (files: FileList) => void
}

function DropZone({
  className,
  title,
  description,
  chooseLabel = 'Kies een bestand',
  accept,
  multiple = false,
  disabled = false,
  onFiles,
  ...props
}: DropZoneProps) {
  const [over, setOver] = useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  function take(files: FileList | null): void {
    if (files === null || files.length === 0 || disabled) return
    onFiles?.(files)
  }

  return (
    <div
      data-slot="drop-zone"
      data-over={over ? '' : undefined}
      className={cn(
        'border-line-control bg-surface text-ink-2 flex flex-col items-center gap-2.5 rounded-[var(--radius-xl)] border-2 border-dashed px-8 py-8 text-center',
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
        {chooseLabel}
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
}

export { DropZone }
