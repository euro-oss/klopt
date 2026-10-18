import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { useT } from '~/i18n/provider'
import { defaultAdvancedMode } from '~/lib/advanced-mode'
import { setAdvancedMode as persistAdvancedMode } from '~/server/advanced-mode'

interface AdvancedModeContextValue {
  readonly advanced: boolean
  readonly setAdvanced: (enabled: boolean) => void | Promise<void>
  readonly toggleAdvanced: () => void | Promise<void>
  /** Set when the last persist failed; cleared on the next attempt. */
  readonly saveFailed: boolean
}

const AdvancedModeContext = createContext<AdvancedModeContextValue | null>(null)

/**
 * Geavanceerd for the shell, the palette, Moneybird, and any screen that asks.
 *
 * - No explicit choice yet → follow the role default for the *active*
 *   administration (Eigenaar off; Boekhouder / Accountant / Controleur on).
 * - After the user toggles → keep that explicit choice across administration
 *   switches (still per user, not per browser).
 * - Remount with `key={session.user.id}` in the layout when the signed-in user
 *   changes, so the next account never inherits in-memory state.
 * - A failed save reverts the switch and surfaces a Dutch error (#65 follow-up).
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

  const advanced = explicit !== null ? explicit : defaultAdvancedMode(role)

  const setAdvanced = useCallback(
    async (enabled: boolean) => {
      const previous = explicit
      setExplicit(enabled)
      setSaveFailed(false)
      try {
        await persistAdvancedMode({ data: { enabled } })
      } catch (cause: unknown) {
        console.error('[app] could not persist Geavanceerd', cause)
        setExplicit(previous)
        setSaveFailed(true)
      }
    },
    [explicit],
  )

  const toggleAdvanced = useCallback(async () => {
    await setAdvanced(!advanced)
  }, [advanced, setAdvanced])

  const value = useMemo(
    () => ({ advanced, setAdvanced, toggleAdvanced, saveFailed }),
    [advanced, setAdvanced, toggleAdvanced, saveFailed],
  )

  return (
    <AdvancedModeContext.Provider value={value}>
      {children}
      {saveFailed && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <Alert
            variant="destructive"
            className="pointer-events-auto max-w-md shadow-none"
            role="alert"
          >
            <AlertDescription>{t('shell.advancedSaveFailed')}</AlertDescription>
          </Alert>
        </div>
      )}
    </AdvancedModeContext.Provider>
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
