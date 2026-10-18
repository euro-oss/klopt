import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { defaultAdvancedMode } from '~/lib/advanced-mode'
import { setAdvancedMode as persistAdvancedMode } from '~/server/advanced-mode'

interface AdvancedModeContextValue {
  readonly advanced: boolean
  readonly setAdvanced: (enabled: boolean) => void | Promise<void>
  readonly toggleAdvanced: () => void | Promise<void>
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
  // null = use role default; boolean = user has chosen.
  const [explicit, setExplicit] = useState<boolean | null>(() =>
    initialHasExplicit ? initial : null,
  )

  const advanced = explicit !== null ? explicit : defaultAdvancedMode(role)

  const setAdvanced = useCallback(async (enabled: boolean) => {
    setExplicit(enabled)
    try {
      await persistAdvancedMode({ data: { enabled } })
    } catch (cause: unknown) {
      console.error('[app] could not persist Geavanceerd', cause)
    }
  }, [])

  const toggleAdvanced = useCallback(async () => {
    await setAdvanced(!advanced)
  }, [advanced, setAdvanced])

  const value = useMemo(
    () => ({ advanced, setAdvanced, toggleAdvanced }),
    [advanced, setAdvanced, toggleAdvanced],
  )

  return <AdvancedModeContext.Provider value={value}>{children}</AdvancedModeContext.Provider>
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
