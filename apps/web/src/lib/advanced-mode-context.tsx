import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Alert, AlertAction, AlertDescription } from '~/components/ui/alert'
import { useT } from '~/i18n/provider'
import { defaultAdvancedMode } from '~/lib/advanced-mode'
import { setAdvancedMode as persistAdvancedMode } from '~/server/advanced-mode'
import { cn } from '~/lib/utils'

interface AdvancedModeContextValue {
  readonly advanced: boolean
  readonly setAdvanced: (enabled: boolean) => void | Promise<void>
  readonly toggleAdvanced: () => void | Promise<void>
  /** Set when the last persist failed; cleared on dismiss or the next attempt. */
  readonly saveFailed: boolean
  /** True while a save POST is in flight — ignore further toggles. */
  readonly saving: boolean
}

const AdvancedModeContext = createContext<AdvancedModeContextValue | null>(null)

/** Auto-dismiss the failure toast after this many ms (paused on hover/focus). */
const SAVE_FAILED_DISMISS_MS = 6_000

/**
 * Geavanceerd for the shell, the palette, the import wizard, and any screen that asks.
 *
 * - No explicit choice yet → follow the role default for the *active*
 *   administration (Eigenaar off; Boekhouder / Accountant / Controleur on).
 * - After the user toggles → keep that explicit choice across administration
 *   switches (still per user, not per browser).
 * - Remount with `key={session.user.id}` in the layout when the signed-in user
 *   changes, so the next account never inherits in-memory state.
 * - A failed save reverts the switch and surfaces a Dutch error (#65 follow-up).
 * - Clicks while a save is in flight are ignored so the final state matches
 *   the server (#66 review).
 */
export function AdvancedModeProvider({
  role,
  initial,
  initialHasExplicit,
  children,
}: {
  role: string
  initial: boolean
  initialHasExplicit: boolean
  children: ReactNode
}) {
  const { t } = useT()
  // null = use role default; boolean = user has chosen.
  const [explicit, setExplicit] = useState<boolean | null>(() =>
    initialHasExplicit ? initial : null,
  )
  const [saveFailed, setSaveFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  // Refs so overlapping clicks see the live in-flight flag / preference,
  // not a stale closure from the previous render.
  const savingRef = useRef(false)
  const explicitRef = useRef(explicit)

  useEffect(() => {
    explicitRef.current = explicit
  }, [explicit])

  const advanced = explicit !== null ? explicit : defaultAdvancedMode(role)

  const dismissSaveFailed = useCallback(() => {
    setSaveFailed(false)
  }, [])

  const setAdvanced = useCallback(async (enabled: boolean) => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)

    const previous = explicitRef.current
    setExplicit(enabled)
    setSaveFailed(false)
    try {
      await persistAdvancedMode({ data: { enabled } })
    } catch (cause: unknown) {
      console.error('[app] could not persist Geavanceerd', cause)
      setExplicit(previous)
      setSaveFailed(true)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [])

  const toggleAdvanced = useCallback(async () => {
    await setAdvanced(!advanced)
  }, [advanced, setAdvanced])

  const value = useMemo(
    () => ({ advanced, setAdvanced, toggleAdvanced, saveFailed, saving }),
    [advanced, setAdvanced, toggleAdvanced, saveFailed, saving],
  )

  return (
    <AdvancedModeContext.Provider value={value}>
      {children}
      {saveFailed && (
        <AdvancedModeSaveFailedToast
          message={t('shell.advancedSaveFailed')}
          onDismiss={dismissSaveFailed}
        />
      )}
    </AdvancedModeContext.Provider>
  )
}

/**
 * Single announced failure toast for Geavanceerd (#66 design review).
 *
 * Opaque destructive tint, one `role="alert"`, Sluiten (44px), auto-dismiss
 * after ~6s paused on hover/focus. On phone it sits above the sticky
 * `.form-actions` bar so it does not cover "Boeken".
 */
function AdvancedModeSaveFailedToast({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  const { t } = useT()
  const remainingRef = useRef(SAVE_FAILED_DISMISS_MS)
  const startedRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const pause = useCallback(() => {
    if (startedRef.current === null) return
    clearTimer()
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedRef.current))
    startedRef.current = null
  }, [clearTimer])

  const resume = useCallback(() => {
    if (startedRef.current !== null) return
    startedRef.current = Date.now()
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      startedRef.current = null
      onDismiss()
    }, remainingRef.current)
  }, [clearTimer, onDismiss])

  useEffect(() => {
    remainingRef.current = SAVE_FAILED_DISMISS_MS
    resume()
    return clearTimer
  }, [resume, clearTimer])

  return (
    <div
      className={cn(
        // Phone: clear the sticky `.form-actions` bar (~44px CTA + padding).
        // Desktop: standard bottom inset.
        'pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4',
        'bottom-20 md:bottom-4',
      )}
    >
      <Alert
        variant="destructive"
        role="alert"
        data-testid="advanced-mode-save-failed"
        onMouseEnter={pause}
        onMouseLeave={resume}
        onFocusCapture={pause}
        onBlurCapture={(event) => {
          const next = event.relatedTarget
          if (next instanceof Node && event.currentTarget.contains(next)) return
          resume()
        }}
        className={cn(
          'pointer-events-auto max-w-md shadow-none',
          // Solid tint: same 8% destructive mix, but on an opaque ground so
          // page text cannot show through (#66 design review).
          'bg-[color-mix(in_oklab,var(--destructive)_8%,var(--background))]',
        )}
      >
        <AlertDescription>{message}</AlertDescription>
        <AlertAction>
          <button
            type="button"
            onClick={onDismiss}
            className={cn(
              'text-foreground hover:bg-muted min-h-11 min-w-11 px-2 text-sm font-medium md:min-h-8 md:min-w-0',
              'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            )}
          >
            {t('common.close')}
          </button>
        </AlertAction>
      </Alert>
    </div>
  )
}

export function useAdvancedMode(): AdvancedModeContextValue {
  const value = useContext(AdvancedModeContext)
  if (value === null) {
    throw new Error('useAdvancedMode needs AdvancedModeProvider')
  }
  return value
}

/** Soft read for surfaces that may render outside the shell (tests, setup). */
export function useOptionalAdvancedMode(): AdvancedModeContextValue | null {
  return useContext(AdvancedModeContext)
}
